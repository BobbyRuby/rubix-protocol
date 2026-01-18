import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

describe('Hello World HTML File', () => {
  const htmlFilePath = resolve(__dirname, '../hello.html')

  it('should exist', () => {
    expect(existsSync(htmlFilePath)).toBe(true)
  })

  it('should contain proper HTML structure', () => {
    const content = readFileSync(htmlFilePath, 'utf-8')
    
    expect(content).toContain('<!DOCTYPE html>')
    expect(content).toContain('<html lang="en">')
    expect(content).toContain('<head>')
    expect(content).toContain('<meta charset="UTF-8">')
    expect(content).toContain('<title>Hello World</title>')
    expect(content).toContain('<body>')
    expect(content).toContain('<h1>Hello World</h1>')
    expect(content).toContain('</html>')
  })

  it('should have Hello World as the main heading', () => {
    const content = readFileSync(htmlFilePath, 'utf-8')
    const h1Match = content.match(/<h1>(.*?)<\/h1>/)
    
    expect(h1Match).toBeTruthy()
    expect(h1Match![1]).toBe('Hello World')
  })

  it('should be valid HTML with proper closing tags', () => {
    const content = readFileSync(htmlFilePath, 'utf-8')
    
    expect(content).toContain('</head>')
    expect(content).toContain('</body>')
    expect(content).toContain('</html>')
    expect(content).toContain('</h1>')
    expect(content).toContain('</p>')
  })
})