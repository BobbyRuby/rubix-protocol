import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

export class FileSystemService {
  private basePath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
  }

  async readFile(filePath: string): Promise<string> {
    const fullPath = path.join(this.basePath, filePath);
    return await fs.readFile(fullPath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.basePath, filePath);
    const dir = path.dirname(fullPath);
    
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.basePath, filePath);
    return existsSync(fullPath);
  }

  async createDirectory(dirPath: string): Promise<void> {
    const fullPath = path.join(this.basePath, dirPath);
    await fs.mkdir(fullPath, { recursive: true });
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const fullPath = path.join(this.basePath, dirPath);
    return await fs.readdir(fullPath);
  }

  async deleteFile(filePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, filePath);
    await fs.unlink(fullPath);
  }

  async copyFile(source: string, destination: string): Promise<void> {
    const sourcePath = path.join(this.basePath, source);
    const destPath = path.join(this.basePath, destination);
    
    const destDir = path.dirname(destPath);
    if (!existsSync(destDir)) {
      await fs.mkdir(destDir, { recursive: true });
    }
    
    await fs.copyFile(sourcePath, destPath);
  }

  // Zombie asset management methods
  async loadZombieSpritesheet(spriteName: string): Promise<Buffer> {
    const spritePath = path.join(this.basePath, 'src/assets/sprites/zombie', `${spriteName}.png`);
    if (!existsSync(spritePath)) {
      throw new Error(`Zombie sprite not found: ${spriteName}`);
    }
    return await fs.readFile(spritePath);
  }

  async saveZombieSprite(spriteName: string, data: Buffer): Promise<void> {
    const spritePath = path.join(this.basePath, 'src/assets/sprites/zombie', `${spriteName}.png`);
    const dir = path.dirname(spritePath);
    
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    await fs.writeFile(spritePath, data);
  }

  async getZombieSpriteList(): Promise<string[]> {
    const spritePath = path.join(this.basePath, 'src/assets/sprites/zombie');
    
    if (!existsSync(spritePath)) {
      await fs.mkdir(spritePath, { recursive: true });
      return [];
    }
    
    const files = await fs.readdir(spritePath);
    return files.filter(file => file.endsWith('.png')).map(file => file.replace('.png', ''));
  }
}