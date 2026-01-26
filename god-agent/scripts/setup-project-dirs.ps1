#
# Setup Project Data Directories (PowerShell)
#
# Creates data directories for each project instance defined in .claude/mcp.json
# Each directory will contain:
#   - god-agent.db (SQLite database)
#   - embeddings/ (HNSW vector indexes)
#   - containment.json (project-specific rules)
#

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Projects
)

# Colors for output
$Green = "Green"
$Blue = "Cyan"
$Yellow = "Yellow"

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor $Blue
Write-Host "  God-Agent Project Directories Setup  " -ForegroundColor $Blue
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor $Blue
Write-Host ""

# Get the script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$GodAgentRoot = Split-Path -Parent $ScriptDir
$DataRoot = Join-Path $GodAgentRoot "data\projects"

# Default projects (if no arguments provided)
$DefaultProjects = @("backend-api", "frontend", "mobile", "infra", "docs")

# Use provided projects or defaults
if ($Projects.Count -eq 0) {
    Write-Host "No projects specified, using defaults:" -ForegroundColor $Yellow
    $Projects = $DefaultProjects
}

Write-Host "Creating directories for projects:"
foreach ($project in $Projects) {
    Write-Host "  • $project"
}
Write-Host ""

# Create directories
foreach ($project in $Projects) {
    $projectDir = Join-Path $DataRoot $project

    if (Test-Path $projectDir) {
        Write-Host "⚠️  Directory already exists: $projectDir" -ForegroundColor $Yellow
    } else {
        New-Item -ItemType Directory -Path $projectDir -Force | Out-Null
        Write-Host "✅ Created: data\projects\$project" -ForegroundColor $Green
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor $Green
Write-Host "Project directories ready!" -ForegroundColor $Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor $Green
Write-Host ""
Write-Host "Each directory will be populated on first use with:"
Write-Host "  • god-agent.db (SQLite database)"
Write-Host "  • embeddings/ (HNSW vector indexes)"
Write-Host "  • containment.json (project-specific rules)"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Configure .claude/mcp.json (or use scripts/configure-projects.js)"
Write-Host "  2. Restart Claude Code"
Write-Host "  3. Start using your project instances!"
Write-Host ""
