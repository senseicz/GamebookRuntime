using GamebookRuntime;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    // Static assets (wwwroot) live next to the app binary — resolve them relative to
    // the DLL, not the current working directory, so the app works from anywhere.
    // In dev builds the binary sits at bin/<cfg>/<tfw>/, with the project (and wwwroot)
    // three levels up; in Docker the publish output has wwwroot right beside the DLL.
    ContentRootPath = AppContext.BaseDirectory,
});
var webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
if (!Directory.Exists(webRoot))
    webRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "wwwroot"));
var webRootFiles = new PhysicalFileProvider(webRoot);

builder.Services.AddSingleton<LocalAdventureSource>();

var app = builder.Build();

// Debug mode (testers) is a *server* setting on purpose: the browser is told
// whether it is on, it never decides. Deployments where DEBUG__ENABLED is not
// set (production) send debug.enabled = false, and nothing the reader does in
// the page can turn it on — the flag never travels through localStorage and is
// not part of the adventure file.
var debugEnabled = app.Configuration.GetValue("Debug:Enabled", false);
if (debugEnabled)
    app.Logger.LogWarning("Debug mode is ON: node keys are shown and stepping back is allowed. Do not enable it in production.");

// The adventure is downloaded during deployment into the data directory
// (see docker-entrypoint.sh); the runtime reads local files only and is
// read-only for its entire lifetime.
Adventure? adventure = null;
try
{
    adventure = app.Services.GetRequiredService<LocalAdventureSource>().LoadAsync(app.Lifetime.ApplicationStopping).Result;
    app.Logger.LogInformation("Loaded adventure '{Title}' ({Id}) from {Path}",
        adventure.Title, adventure.Id, app.Services.GetRequiredService<LocalAdventureSource>().FullPath);
}
catch (Exception ex)
{
    app.Logger.LogError(ex, "Failed to load adventure. Has the deployment step downloaded it into the data directory?");
    if (app.Environment.IsProduction()) throw;
}

app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = webRootFiles });
app.UseStaticFiles(new StaticFileOptions { FileProvider = webRootFiles });

// The HTML shell must never be cached — it loads app.js/styles.css by name,
// and a stale cached shell is how old UI code ends up running against a new API.
app.Use(async (context, next) =>
{
    if (context.Request.Path == "/" || context.Request.Path.StartsWithSegments("/index.html"))
        context.Response.Headers.CacheControl = "no-cache";
    await next();
});

// ---------- API ----------

// Adventure metadata (drives UI language via labels)
app.MapGet("/api/adventure", () => Results.Ok(new
{
    id = adventure!.Id, title = adventure.Title, author = adventure.Author,
    language = adventure.Language, start = adventure.Start,
    intro = string.IsNullOrWhiteSpace(adventure.Intro) ? null : adventure.Intro,
    labels = adventure.Labels.Count > 0 ? adventure.Labels : null,
    debug = new { enabled = debugEnabled },
    inventory = adventure.Inventory is { Enabled: true } ? new
    {
        title = adventure.Inventory.Title,
        hideUndiscovered = adventure.Inventory.HideUndiscovered,
        items = adventure.Inventory.Items.ToDictionary(
            kv => kv.Key, kv => new { name = kv.Value.Name, description = kv.Value.Description }),
    } : null,
}));

// A single node of the story, by key
app.MapGet("/api/node/{key}", (string key) =>
{
    if (!adventure!.Nodes.TryGetValue(key, out var node))
        return Results.NotFound(new { error = $"Unknown step '{key}'" });
    return Results.Ok(new
    {
        key,
        text = node.Text,
        image = node.Image,
        ending = node.Ending,
        grant = node.Grant ?? [],
        remove = node.Remove ?? [],
        options = node.Options.Select(o => new
        {
            text = o.Text,
            next = o.Next,
            requires = o.Requires ?? [],
            requiresAny = o.RequiresAny ?? [],
            lockedIfOwned = o.LockedIfOwned ?? [],
            showAfterAny = o.ShowAfterAny ?? [],
            grant = o.Grant ?? [],
            remove = o.Remove ?? [],
            dice = o.Dice is null ? null : new
            {
                sides = o.Dice.Sides,
                label = o.Dice.Label,
                outcomes = o.Dice.Outcomes.Select(x => new { from = x.From, to = x.To, next = x.Next, success = x.Success })
            }
        })
    });
});

// Server-side dice roll. The reader never types in a value: the runtime throws
// the die, and the step shows which values it takes to succeed.
app.MapGet("/api/roll", (int sides) =>
{
    if (sides < 2 || sides > 100) sides = 6;
    var value = Random.Shared.Next(1, sides + 1);
    return Results.Ok(new { value });
});

app.MapGet("/healthz", () => Results.Ok("ok"));

app.Run();
