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
    /// <summary>Optional prologue shown on the title screen above the start button, so a long
    /// introduction does not have to be the first node. Markdown subset: paragraphs, **bold**,
    /// *italic*, # headings, ![alt](url) images, [link](url).</summary>
    public string? Intro { get; set; }
    /// <summary>All story nodes, keyed by node key.</summary>
    public Dictionary<string, AdventureNode> Nodes { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Optional paths to chapter files (relative to this file) whose nodes are merged into this adventure.</summary>
    public List<string>? Chapters { get; set; }
    /// <summary>Optional custom labels, keyed by language tag, for UI strings. Falls back to English defaults.</summary>
    public Dictionary<string, Dictionary<string, string>> Labels { get; set; } = new();
    /// <summary>Optional inventory system. When null/disabled, no inventory UI is shown.</summary>
    public InventorySettings? Inventory { get; set; }
}

public sealed class InventorySettings
{
    /// <summary>Whether the inventory is used in this adventure.</summary>
    public bool Enabled { get; set; }
    /// <summary>Optional custom title of the inventory panel (UI language aware via labels otherwise).</summary>
    public string? Title { get; set; }
    /// <summary>Known items/knowledge, keyed by item key. Nodes and options grant these; options may require them.</summary>
    public Dictionary<string, InventoryItem> Items { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>When true (default), item names are hidden until first granted ("???").</summary>
    public bool HideUndiscovered { get; set; } = true;
}

public sealed class InventoryItem
{
    /// <summary>Display name shown in the inventory.</summary>
    public string Name { get; set; } = "";
    /// <summary>Optional short description shown as a tooltip/expandable text.</summary>
    public string? Description { get; set; }
}

public sealed class AdventureNode
{
    /// <summary>Story text. Markdown subset: paragraphs, **bold**, *italic*, # headings, ![alt](url) images, [link](url).</summary>
    public string Text { get; set; } = "";
    /// <summary>Optional image URL shown above the text.</summary>
    public string? Image { get; set; }
    /// <summary>Item/knowledge keys granted to the player when this node is entered. Requires inventory to be enabled.</summary>
    public List<string>? Grant { get; set; }
    /// <summary>Item/knowledge keys lost when this node is entered (dropped, taken away, used up). Requires inventory to be enabled.</summary>
    public List<string>? Remove { get; set; }
    /// <summary>Choices offered to the reader. 1..n options.</summary>
    public List<AdventureOption> Options { get; set; } = new();
    /// <summary>If true, this is an ending — no options expected.</summary>
    public bool Ending { get; set; }
}

public sealed class AdventureOption
{
    /// <summary>Label of the choice shown to the reader.</summary>
    public string Text { get; set; } = "";
    /// <summary>Key of the node to go to when chosen. Not used when <see cref="Dice"/> is set —
    /// the dice outcomes carry the destinations then.</summary>
    public string Next { get; set; } = "";
    /// <summary>Item/knowledge keys the player must have for this option to be usable. Requires inventory to be enabled.</summary>
    public List<string>? Requires { get; set; }
    /// <summary>Item/knowledge keys of which the player must have at least one. Combined with Requires, both must hold.</summary>
    public List<string>? RequiresAny { get; set; }
    /// <summary>Item/knowledge keys that close this option off: when the player owns ANY of them the option
    /// is not offered at all (hidden, not locked). For hub steps the player can return to — "buy the vial of
    /// oil" must disappear once the oil is in the bag. Requires inventory to be enabled.</summary>
    public List<string>? LockedIfOwned { get; set; }
    /// <summary>Node keys that reveal this option after any one of them has been visited.
    /// Hidden until then, regardless of inventory; also applies to dice steps.</summary>
    public List<string>? ShowAfterAny { get; set; }
    /// <summary>Item/knowledge keys granted when this option is chosen — what the player takes away from doing it. Requires inventory to be enabled.</summary>
    public List<string>? Grant { get; set; }
    /// <summary>Item/knowledge keys lost when this option is chosen (given away, spent, seized). Requires inventory to be enabled.</summary>
    public List<string>? Remove { get; set; }
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
    /// <summary>When true, this range is the winning roll: the step shows these values as its
    /// "succeeds on …" hint. Optional — an unmarked dice step simply does not advertise odds.</summary>
    public bool Success { get; set; }
}
