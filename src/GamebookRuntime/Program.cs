using GamebookRuntime;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<LocalAdventureSource>();

var app = builder.Build();

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

app.UseDefaultFiles();
app.UseStaticFiles();

// ---------- API ----------

// Adventure metadata (drives UI language via labels)
app.MapGet("/api/adventure", () => Results.Ok(new
{
    id = adventure!.Id, title = adventure.Title, author = adventure.Author,
    language = adventure.Language, start = adventure.Start,
    labels = adventure.Labels.Count > 0 ? adventure.Labels : null,
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

// Server-side dice roll. The client may also pass the result of the reader's
// own physical die (the input field); both paths resolve the same outcomes.
app.MapGet("/api/roll", (int sides) =>
{
    if (sides < 2 || sides > 100) sides = 6;
    var value = Random.Shared.Next(1, sides + 1);
    return Results.Ok(new { value });
});

app.MapGet("/healthz", () => Results.Ok("ok"));

app.Run();
