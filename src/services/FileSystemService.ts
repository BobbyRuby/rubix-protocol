import { promises as fs } from 'fs';
import { dirname } from 'path';

export class FileSystemService {
  async writeFile(path: string, content: string): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(dirname(path), { recursive: true });
      
      // Write file
      await fs.writeFile(path, content, 'utf-8');
      console.log(`File written: ${path}`);
    } catch (error) {
      console.error(`Failed to write file ${path}:`, error);
      throw error;
    }
  }

  async readFile(path: string): Promise<string> {
    try {
      return await fs.readFile(path, 'utf-8');
    } catch (error) {
      console.error(`Failed to read file ${path}:`, error);
      throw error;
    }
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await fs.unlink(path);
      console.log(`File deleted: ${path}`);
    } catch (error) {
      console.error(`Failed to delete file ${path}:`, error);
      throw error;
    }
  }
}