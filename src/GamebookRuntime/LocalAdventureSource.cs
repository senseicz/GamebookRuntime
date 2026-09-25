using System.Text.Json;

namespace GamebookRuntime;

/// <summary>
/// Loads the adventure from the local filesystem. The adventure is downloaded
/// during deployment (see docker-entrypoint.sh), so the runtime itself never
/// talks to GitHub and starts instantly from local files.
/// </summary>
public sealed class LocalAdventureSource(IConfiguration config, ILogger<LocalAdventureSource> logger)
{
    /// <summary>Directory that holds the downloaded adventure (defaults to ./data, /data in Docker).</summary>
    public string DataDir { get; } = config["Adventure:DataDir"] ?? "data";

    /// <summary>Path of the main adventure file, relative to DataDir.</summary>
    public string FilePath { get; } = config["Adventure:FilePath"] ?? "adventure.json";

    public string FullPath => Path.Combine(DataDir, FilePath.Replace('/', Path.DirectorySeparatorChar));

    public async Task<Adventure> LoadAsync(CancellationToken ct = default)
    {
        if (!File.Exists(FullPath))
            throw new InvalidOperationException(
                $"Adventure file '{FullPath}' not found. " +
                "The deployment step must download the adventure into the data directory (see docker-entrypoint.sh / README).");

        var json = await File.ReadAllTextAsync(FullPath, ct);
        var adventure = Deserialize(json, FilePath);

        // Chapters: additional JSON files with more nodes/labels, merged at load time.
        var problems = new List<string>();
        foreach (var chapter in adventure.Chapters ?? [])
        {
            var chapterPath = ResolveRelative(FilePath, chapter);
            var chapterFullPath = Path.Combine(DataDir, chapterPath.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(chapterFullPath))
            {
                problems.Add($"chapter '{chapter}' not found at '{chapterFullPath}'");
                continue;
            }
            var chapterAdventure = Deserialize(await File.ReadAllTextAsync(chapterFullPath, ct), chapterPath);

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

    private static Adventure Deserialize(string json, string sourceName)
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

    private static string ResolveRelative(string basePath, string relative)
    {
        if (Path.IsPathRooted(relative)) return relative;
        var dir = Path.GetDirectoryName(basePath);
        return string.IsNullOrEmpty(dir) ? relative : $"{dir}/{relative}".Replace("\\", "/");
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
                    var covered = new HashSet<int>(opt.Dice.Outcomes.SelectMany(o => Enumerable.Range(o.From, Math.Max(0, o.To - o.From + 1))));
                    if (!Enumerable.Range(1, sides).All(covered.Contains))
                        problems.Add($"node '{key}' dice does not cover values 1..{sides}");
                }
            }
        }

        if (problems.Count > 0)
            throw new InvalidOperationException("Adventure validation failed:\n - " + string.Join("\n - ", problems));
    }
}
