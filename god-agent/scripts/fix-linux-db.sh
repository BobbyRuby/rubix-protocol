#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "═══════════════════════════════════════════════"
echo "     RUBIX Linux DB Fix"
echo "═══════════════════════════════════════════════"
echo ""

# Determine project root (script is in scripts/)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "Project directory: $PROJECT_DIR"
echo ""

# ─── Step 1: Copy schema.sql to dist if missing ──────────────────────
echo "[1/3] Checking dist/storage/schema.sql..."
if [ ! -f "$PROJECT_DIR/dist/storage/schema.sql" ]; then
    mkdir -p "$PROJECT_DIR/dist/storage"
    if [ -f "$PROJECT_DIR/src/storage/schema.sql" ]; then
        cp "$PROJECT_DIR/src/storage/"*.sql "$PROJECT_DIR/dist/storage/"
        echo "       Copied schema.sql to dist/storage/"
    else
        echo "ERROR: src/storage/schema.sql not found. Is this the god-agent root?"
        exit 1
    fi
else
    echo "       Already exists."
fi

# ─── Step 2: Rebuild better-sqlite3 if needed ────────────────────────
echo "[2/3] Checking better-sqlite3 native module..."
if ! node -e "require('better-sqlite3')" 2>/dev/null; then
    echo "       Rebuilding better-sqlite3..."
    npm rebuild better-sqlite3
    if ! node -e "require('better-sqlite3')" 2>/dev/null; then
        echo "ERROR: better-sqlite3 rebuild failed. Ensure build-essential is installed:"
        echo "  sudo apt-get install -y build-essential python3"
        exit 1
    fi
    echo "       Rebuilt successfully."
else
    echo "       OK."
fi

# ─── Step 3: Run migrations on existing DB ────────────────────────────
echo "[3/3] Running migrations on existing database..."

DATA_DIR="${RUBIX_DATA_DIR:-./data}"

node -e "
const path = require('path');
const distDir = path.resolve('$PROJECT_DIR/dist');

// Load SQLiteStorage which runs migrations in constructor
try {
    const { SQLiteStorage } = require(path.join(distDir, 'storage', 'SQLiteStorage'));
    const storage = new SQLiteStorage('${DATA_DIR}');
    console.log('       Migrations applied successfully.');
    storage.close();
} catch (e) {
    // Try alternate export pattern
    try {
        const mod = require(path.join(distDir, 'storage', 'SQLiteStorage'));
        const StorageClass = mod.SQLiteStorage || mod.default;
        const storage = new StorageClass('${DATA_DIR}');
        console.log('       Migrations applied successfully.');
        storage.close();
    } catch (e2) {
        console.error('       Error running migrations:', e2.message);
        console.error('       You may need to run: npm run build');
        process.exit(1);
    }
}
"

echo ""
echo "Fix complete. Your database should now have all required columns."
echo ""
