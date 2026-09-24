using GamebookRuntime;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHttpClient<GitHubAdventureSource>();
builder.Services.AddOutputCache();

var app = builder.Build();

// Cache the adventure per branch so GitHub is hit once, not on every request.
// The in-memory copy is read-only for the lifetime of the running instance.
var cache = new Dictionary<string, Adventure>();
var cacheLock = new object();

async Task<Adventure> GetAdventureAsync(string? branch, CancellationToken ct)
{
    var source = app.Services.GetRequiredService<GitHubAdventureSource>();
    var key = branch ?? source.DefaultBranch;
    lock (cache)
    {
        if (cache.TryGetValue(key, out var cached)) return cached;
    }
    var adventure = await source.LoadAsync(branch, ct);
    lock (cache) cache[key] = adventure;
    return adventure;
}

app.UseDefaultFiles();
app.UseStaticFiles();

// ---------- API ----------

// Adventure metadata (never exposes repo name or file path)
app.MapGet("/api/adventure", async (string? branch, CancellationToken ct) =>
{
    var a = await GetAdventureAsync(branch, ct);
    return Results.Ok(new
    {
        id = a.Id, title = a.Title, author = a.Author, language = a.Language,
        start = a.Start, labels = a.Labels.Count > 0 ? a.Labels : null,
    });
});

// Branch list — only when the author enabled branch selection at deploy time
app.MapGet("/api/branches", async (CancellationToken ct) =>
{
    var source = app.Services.GetRequiredService<GitHubAdventureSource>();
    if (!source.AllowBranchSelection)
        return Results.Json(new { allowed = false, branches = Array.Empty<string>() }, statusCode: 200);
    var branches = await source.ListBranchesAsync(ct);
    return Results.Ok(new { allowed = true, branches });
});

// A single node of the story, by key, optionally from a chosen branch
app.MapGet("/api/node/{key}", async (string key, string? branch, CancellationToken ct) =>
{
    var a = await GetAdventureAsync(branch, ct);
    if (!a.Nodes.TryGetValue(key, out var node))
        return Results.NotFound(new { error = $"Unknown step '{key}'" });
    return Results.Ok(new
    {
        key,
        text = node.Text,
        image = node.Image,
        ending = node.Ending,
        options = node.Options.Select(o => new
        {
            text = o.Text,
            next = o.Next,
            dice = o.Dice is null ? null : new
            {
                sides = o.Dice.Sides,
                label = o.Dice.Label,
                outcomes = o.Dice.Outcomes.Select(x => new { from = x.From, to = x.To, next = x.Next })
            }
        })
    });
});

// Server-side dice roll. The client may also roll locally and pass ?value=1..6
// (for readers rolling physical dice); the server clamps/rejects invalid values.
app.MapGet("/api/roll", (int sides, string? branch) =>
{
    if (sides < 2 || sides > 100) sides = 6;
    var value = Random.Shared.Next(1, sides + 1);
    return Results.Ok(new { value });
});

app.MapGet("/healthz", () => Results.Ok("ok"));

// Fail fast at startup if the adventure cannot be loaded — a runtime without
// a valid adventure should not pretend to work.
var src = app.Services.GetRequiredService<GitHubAdventureSource>();
try
{
    var a = await GetAdventureAsync(null, app.Lifetime.ApplicationStopping);
    app.Logger.LogInformation("Loaded adventure '{Title}' ({Id}) from {Repo}@{Branch}",
        a.Title, a.Id, src.Repo, src.DefaultBranch);
}
catch (Exception ex)
{
    app.Logger.LogError(ex, "Failed to load adventure from GitHub. Check ADVENTURE__GITHUB_REPO / branch / file path / token.");
    if (app.Environment.IsProduction()) throw;
}

app.Run();
