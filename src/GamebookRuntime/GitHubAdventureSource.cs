using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace GamebookRuntime;

/// <summary>
/// Loads the adventure from a GitHub repository. Runs entirely server-side:
/// the repo name, token and file paths are never exposed to the browser.
/// The loaded adventure is immutable for the lifetime of the process.
/// </summary>
public sealed class GitHubAdventureSource
{
    private const string ApiBase = "https://api.github.com";

    private readonly HttpClient _http;
    private readonly ILogger<GitHubAdventureSource> _logger;

    public string Repo { get; }          // "owner/name"
    public string DefaultBranch { get; } // branch used when branch selection is disabled
    public string FilePath { get; }      // path to adventure JSON inside the repo
    public bool AllowBranchSelection { get; }
    public string? Token { get; }
    private readonly bool _isLocal;
    public string? LocalFile { get; }

    public GitHubAdventureSource(IConfiguration config, HttpClient http, ILogger<GitHubAdventureSource> logger)
    {
        _http = http;
        _logger = logger;

        // "local:<path>" loads a file from disk (dev/testing only); otherwise owner/name of a GitHub repo
        var repo = config["Adventure:GitHubRepo"]
            ?? throw new InvalidOperationException(
                "Adventure:GitHubRepo is not configured. Set ADVENTURE__GITHUB_REPO=owner/name (env var) or Adventure:GitHubRepo in appsettings.");

        if (repo.StartsWith("local:", StringComparison.OrdinalIgnoreCase))
        {
            _isLocal = true;
            LocalFile = repo["local:".Length..];
            Repo = "(local file)";
            DefaultBranch = "main";
            FilePath = LocalFile;
            AllowBranchSelection = false;
            Token = null;
        }
        else
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(repo, @"^[\w.\-]+/[\w.\-]+$"))
                throw new InvalidOperationException($"Adventure:GitHubRepo '{repo}' is not in owner/name format.");
            Repo = repo;
            DefaultBranch = config["Adventure:Branch"] ?? "main";
            FilePath = config["Adventure:FilePath"] ?? "adventure.json";
            AllowBranchSelection = config.GetValue("Adventure:AllowBranchSelection", false);
            Token = config["Adventure:Token"];
        }

        _http.BaseAddress = new Uri(ApiBase);
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("GamebookRuntime/1.0");
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        if (!string.IsNullOrEmpty(Token))
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
    }

    /// <summary>List branch names. Only called when branch selection is enabled.</summary>
    public async Task<List<string>> ListBranchesAsync(CancellationToken ct = default)
    {
        var branches = await _http.GetFromJsonAsync<List<BranchDto>>($"/repos/{Repo}/branches?per_page=100", ct)
            ?? throw new InvalidOperationException($"Could not list branches of '{Repo}'. Is the repo public or the token valid?");
        return branches.Select(b => b.Name).ToList();
    }

    /// <summary>
    /// Fetch and parse the adventure (main file plus any chapter files) from a
    /// specific branch, or the default branch. Chapters are merged into one
    /// read-only adventure at load time.
    /// </summary>
    public async Task<Adventure> LoadAsync(string? branch = null, CancellationToken ct = default)
    {
        var json = await FetchJsonAsync(FilePath, branch, ct);

        var adventure = Deserialize(json, FilePath);

        // Chapters: additional JSON files with more nodes/labels, merged at load time.
        var problems = new List<string>();
        foreach (var chapter in adventure.Chapters ?? [])
        {
            var chapterPath = ResolveRelative(FilePath, chapter);
            var chapterJson = await FetchJsonAsync(chapterPath, branch, ct);
            var chapterAdventure = Deserialize(chapterJson, chapterPath);

            foreach (var (key, node) in chapterAdventure.Nodes)
            {
                if (!adventure.Nodes.TryAdd(key, node))
                    problems.Add($"duplicate node key '{key}' in chapter '{chapter}'");
            }
            foreach (var (lang, labels) in chapterAdventure.Labels)
            {
                var target = adventure.Labels.TryGetValue(lang, out var existing)
                    ? existing
                    : adventure.Labels[lang] = new(StringComparer.Ordinal);
                foreach (var (k, v) in labels) target[k] = v;
            }
        }

        if (problems.Count > 0)
            throw new InvalidOperationException("Adventure chapter merge failed:\n - " + string.Join("\n - ", problems));

        Validate(adventure);
        return adventure;
    }

    private Adventure Deserialize(string json, string sourceName)
    {
        try
        {
            return JsonSerializer.Deserialize<Adventure>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                ReadCommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true,
            }) ?? throw new InvalidOperationException($"'{sourceName}' is not a valid adventure file.");
        }
        catch (System.Text.Json.JsonException e)
        {
            throw new InvalidOperationException($"'{sourceName}' is not valid JSON: {e.Message}");
        }
    }

    /// <summary>Resolve a chapter path relative to the main adventure file.</summary>
    private string ResolveRelative(string basePath, string relative)
    {
        if (Path.IsPathRooted(relative)) return relative;
        var dir = Path.GetDirectoryName(basePath);
        return string.IsNullOrEmpty(dir) ? relative : $"{dir}/{relative}".Replace("\\", "/");
    }

    private async Task<string> FetchJsonAsync(string path, string? branch, CancellationToken ct)
    {
        if (_isLocal)
            return await File.ReadAllTextAsync(path, ct);

        var b = branch is null ? DefaultBranch : Uri.EscapeDataString(branch);
        var url = $"/repos/{Repo}/contents/{Uri.EscapeDataString(path).Replace("%2F", "/")}?ref={b}";

        using var resp = await _http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"Could not fetch '{path}' from {Repo}@{b}: HTTP {(int)resp.StatusCode}. " +
                "Check the repo name, branch, file path and token.");

        // Base64 content payload from the GitHub contents API
        using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var content = doc.RootElement.GetProperty("content").GetString()!
            .Replace("\n", "").Replace("\\n", "");
        return System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(content));
    }

    private static void Validate(Adventure a)
    {
        var problems = new List<string>();
        if (string.IsNullOrWhiteSpace(a.Id)) problems.Add("id is required");
        if (string.IsNullOrWhiteSpace(a.Title)) problems.Add("title is required");
        if (string.IsNullOrWhiteSpace(a.Start) || !a.Nodes.ContainsKey(a.Start))
            problems.Add($"start node '{a.Start}' does not exist");

        foreach (var (key, node) in a.Nodes)
        {
            if (!node.Ending && node.Options.Count == 0)
                problems.Add($"node '{key}' has no options and is not marked as ending");
            foreach (var opt in node.Options)
            {
                if (opt.Dice is null)
                {
                    if (!a.Nodes.ContainsKey(opt.Next))
                        problems.Add($"node '{key}' option '{opt.Text}' points to missing node '{opt.Next}'");
                }
                else
                {
                    var sides = opt.Dice.Sides;
                    foreach (var o in opt.Dice.Outcomes)
                        if (!a.Nodes.ContainsKey(o.Next))
                            problems.Add($"node '{key}' dice outcome [{o.From}-{o.To}] points to missing node '{o.Next}'");
                    // warn-level check: full coverage is the author's responsibility but gap => dead end
                    var covered = new HashSet<int>(opt.Dice.Outcomes.SelectMany(o => Enumerable.Range(o.From, Math.Max(0, o.To - o.From + 1))));
                    if (!Enumerable.Range(1, sides).All(covered.Contains))
                        problems.Add($"node '{key}' dice does not cover values 1..{sides}");
                }
            }
        }

        if (problems.Count > 0)
            throw new InvalidOperationException("Adventure validation failed:\n - " + string.Join("\n - ", problems));
    }

    private sealed record BranchDto(string Name);
}
