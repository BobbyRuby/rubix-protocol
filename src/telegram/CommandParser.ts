export interface ParsedCommand {
  command: string;
  args: string[];
  rawText: string;
  isCommand: boolean;
}

export class CommandParser {
  static parse(text: string): ParsedCommand {
    const trimmedText = text.trim();
    
    if (!trimmedText.startsWith('/')) {
      return {
        command: '',
        args: [],
        rawText: trimmedText,
        isCommand: false
      };
    }

    const parts = trimmedText.split(/\s+/);
    const commandPart = parts[0];
    const command = commandPart.slice(1).toLowerCase();
    const args = parts.slice(1);

    return {
      command,
      args,
      rawText: trimmedText,
      isCommand: true
    };
  }

  static extractTaskDescription(args: string[]): string {
    return args.join(' ').trim();
  }

  static isValidCommand(command: string): boolean {
    const validCommands = ['task', 'status', 'cancel', 'help', 'list'];
    return validCommands.includes(command);
  }
}