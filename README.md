# CODEX Telegram Bot

A Telegram bot interface for CODEX autonomous code generation agent that allows users to submit coding tasks and receive real-time updates.

## Features

- **Command Interface**: Support for `/task`, `/status`, `/cancel`, `/list`, and `/help` commands
- **Real-time Updates**: Receive progress notifications as tasks are executed
- **Task Management**: Track multiple tasks per user with unique IDs
- **Error Handling**: Robust error handling and user feedback
- **Automatic Cleanup**: Old completed tasks are automatically cleaned up

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Create Telegram Bot**
   - Message [@BotFather](https://t.me/botfather) on Telegram
   - Create a new bot with `/newbot`
   - Save the bot token

3. **Configuration**
   ```bash
   cp .env.example .env
   # Edit .env and add your TELEGRAM_BOT_TOKEN
   ```

4. **Build and Run**
   ```bash
   npm run build
   npm start
   ```

   Or for development:
   ```bash
   npm run dev
   ```

## Usage

### Available Commands

- `/task <description>` - Create a new coding task
- `/status [task-id]` - Check task status (shows latest task if no ID provided)
- `/cancel [task-id]` - Cancel specific task or all active tasks
- `/list` - Show your recent tasks
- `/help` - Display help information

### Examples

```
/task Create a REST API with user authentication and JWT tokens

/status abc123-def456-ghi789

/cancel abc123-def456-ghi789

/list
```

## Architecture

- **TelegramBot**: Core bot functionality and API communication
- **CommandParser**: Parse and validate user commands
- **CommandHandler**: Handle different commands and generate responses  
- **TaskManager**: Manage task lifecycle and user associations
- **TelegramInterface**: Main orchestrator that ties everything together

## Task Statuses

- 🔄 **pending** - Task is queued for execution
- ⚡ **running** - Task is currently being executed
- ✅ **completed** - Task finished successfully
- ❌ **failed** - Task execution failed
- 🚫 **cancelled** - Task was cancelled by user

## Development

The bot uses TypeScript with strict type checking and follows these patterns:

- Event-driven architecture for real-time updates
- Proper error handling and user feedback
- Clean separation of concerns
- Comprehensive logging

## Environment Variables

- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token (required)
- `LOG_LEVEL` - Logging level (optional, default: info)
- `POLLING_INTERVAL` - Message polling interval in ms (optional, default: 1000)