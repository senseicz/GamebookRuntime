namespace GamebookRuntime;

/// <summary>Adventure data model. Adventures live in the author's GitHub repo as JSON.</summary>
public sealed class Adventure
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    /// <summary>BCP-47 language tag of the adventure text (e.g. "en", "cs", "de"). UI adapts where possible.</summary>
    public string Language { get; set; } = "en";
    /// <summary>Optional author/credit line shown on the title screen.</summary>
    public string Author { get; set; } = "";
    /// <summary>Key of the first node.</summary>
    public string Start { get; set; } = "";
    /// <summary>All story nodes, keyed by node key.</summary>
    public Dictionary<string, AdventureNode> Nodes { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Optional custom labels, keyed by language tag, for UI strings. Falls back to English defaults.</summary>
    public Dictionary<string, Dictionary<string, string>> Labels { get; set; } = new();
}

public sealed class AdventureNode
{
    /// <summary>Story text. Markdown subset: paragraphs, **bold**, *italic*, # headings, ![alt](url) images, [link](url).</summary>
    public string Text { get; set; } = "";
    /// <summary>Optional image URL shown above the text.</summary>
    public string? Image { get; set; }
    /// <summary>Choices offered to the reader. 1..n options.</summary>
    public List<AdventureOption> Options { get; set; } = new();
    /// <summary>If true, this is an ending — no options expected.</summary>
    public bool Ending { get; set; }
}

public sealed class AdventureOption
{
    /// <summary>Label of the choice shown to the reader.</summary>
    public string Text { get; set; } = "";
    /// <summary>Key of the node to go to when chosen.</summary>
    public string Next { get; set; } = "";
    /// <summary>If set, this choice resolves via a dice throw (1..6) instead of going straight to Next.</summary>
    public DiceRoll? Dice { get; set; }
}

public sealed class DiceRoll
{
    /// <summary>Ranges of the dice value mapped to destination nodes. Ranges must cover 1..6 (or 1..Sides).</summary>
    public List<DiceOutcome> Outcomes { get; set; } = new();
    /// <summary>Number of sides; only 6 is required by spec, others allowed.</summary>
    public int Sides { get; set; } = 6;
    /// <summary>Optional label for the dice action, e.g. "Roll the dice".</summary>
    public string? Label { get; set; }
}

public sealed class DiceOutcome
{
    /// <summary>Inclusive minimum dice value.</summary>
    public int From { get; set; }
    /// <summary>Inclusive maximum dice value.</summary>
    public int To { get; set; }
    /// <summary>Destination node key.</summary>
    public string Next { get; set; } = "";
}
