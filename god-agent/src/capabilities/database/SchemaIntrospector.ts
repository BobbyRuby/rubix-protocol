/**
 * SchemaIntrospector
 *
 * Database schema introspection for understanding data structures.
 * Uses knex for multi-database support (PostgreSQL, MySQL, SQLite, etc.).
 */

import knex, { Knex } from 'knex';

import type { DatabaseConfig } from '../types.js';
import type {
  DatabaseSchema,
  TableSchema,
  ColumnSchema,
  IndexSchema,
  ViewSchema,
  RelationshipSchema,
  GeneratedTypes
} from '../types.js';
import type {
  DBConnection,
  TableInfo,
  ForeignKeyInfo,
  TypeGeneratorOptions
} from './types.js';

/**
 * SchemaIntrospector - Database introspection operations
 */
export class SchemaIntrospector {
  private config: DatabaseConfig;
  private db: Knex | null = null;
  private schemaCache: DatabaseSchema | null = null;
  private cacheTime: number = 0;
  private cacheTTL: number = 60000; // 1 minute

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * Initialize database connection
   */
  async initialize(): Promise<void> {
    if (!this.config.connectionString && !this.config.client) {
      throw new Error('Database connection string or client configuration required');
    }

    const connection = this.parseConnectionString(this.config.connectionString);

    this.db = knex({
      client: this.config.client ?? connection.client,
      connection: connection.connection,
      pool: { min: 0, max: 3 }
    });

    // Test connection
    await this.db.raw('SELECT 1');
  }

  /**
   * Shutdown database connection
   */
  async shutdown(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }
    this.schemaCache = null;
  }

  /**
   * Get full database schema
   */
  async getSchema(): Promise<DatabaseSchema> {
    // Check cache
    if (this.schemaCache && Date.now() - this.cacheTime < this.cacheTTL) {
      return this.schemaCache;
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const tables = await this.getTables();
    const views = await this.getViews();
    const relationships = await this.getRelationships();

    const schema: DatabaseSchema = {
      tables,
      views,
      relationships
    };

    this.schemaCache = schema;
    this.cacheTime = Date.now();

    return schema;
  }

  /**
   * Get table schemas
   */
  private async getTables(): Promise<TableSchema[]> {
    if (!this.db) throw new Error('Database not initialized');

    const tableInfos = await this.getTableList();
    const tables: TableSchema[] = [];

    for (const tableInfo of tableInfos) {
      const columns = await this.getColumns(tableInfo.tableName);
      const indexes = await this.getIndexes(tableInfo.tableName);
      const primaryKey = columns.filter(c => c.isPrimaryKey).map(c => c.name);

      tables.push({
        name: tableInfo.tableName,
        columns,
        primaryKey,
        indexes
      });
    }

    return tables;
  }

  /**
   * Get list of tables
   */
  private async getTableList(): Promise<TableInfo[]> {
    if (!this.db) throw new Error('Database not initialized');

    const client = this.db.client.config.client;
    let query: string;

    switch (client) {
      case 'pg':
      case 'postgresql':
        query = `
          SELECT table_name as "tableName"
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `;
        break;

      case 'mysql':
      case 'mysql2':
        query = `
          SELECT table_name as tableName
          FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
        `;
        break;

      case 'sqlite3':
      case 'better-sqlite3':
        query = `
          SELECT name as tableName
          FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        `;
        break;

      default:
        throw new Error(`Unsupported database client: ${client}`);
    }

    const result = await this.db.raw(query);
    const rows = this.extractRows(result);

    return rows.map(row => ({
      tableName: String(row.tableName ?? row.table_name ?? row.name ?? '')
    }));
  }

  /**
   * Get columns for a table
   */
  private async getColumns(tableName: string): Promise<ColumnSchema[]> {
    if (!this.db) throw new Error('Database not initialized');

    const columnInfo = await this.db(tableName).columnInfo();
    const foreignKeys = await this.getForeignKeys(tableName);

    const columns: ColumnSchema[] = [];

    for (const [name, info] of Object.entries(columnInfo)) {
      const fk = foreignKeys.find(f => f.columnName === name);

      columns.push({
        name,
        type: info.type,
        nullable: info.nullable,
        defaultValue: info.defaultValue,
        isPrimaryKey: info.type.includes('primary') || false,
        isForeignKey: !!fk,
        references: fk ? {
          table: fk.referencedTable,
          column: fk.referencedColumn
        } : undefined
      });
    }

    return columns;
  }

  /**
   * Get indexes for a table
   */
  private async getIndexes(tableName: string): Promise<IndexSchema[]> {
    if (!this.db) throw new Error('Database not initialized');

    const client = this.db.client.config.client;
    const indexes: IndexSchema[] = [];

    try {
      let query: string;

      switch (client) {
        case 'pg':
        case 'postgresql':
          query = `
            SELECT
              i.relname as index_name,
              a.attname as column_name,
              ix.indisunique as is_unique,
              ix.indisprimary as is_primary
            FROM pg_index ix
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE t.relname = '${tableName}'
          `;
          break;

        case 'mysql':
        case 'mysql2':
          query = `SHOW INDEX FROM ${tableName}`;
          break;

        case 'sqlite3':
        case 'better-sqlite3':
          query = `PRAGMA index_list('${tableName}')`;
          break;

        default:
          return [];
      }

      const result = await this.db.raw(query);
      const rows = this.extractRows(result);

      // Group by index name
      const indexMap = new Map<string, IndexSchema>();

      for (const row of rows) {
        const name = String(row.index_name ?? row.Key_name ?? row.name ?? '');
        const column = row.column_name ?? row.Column_name;
        const unique = Boolean(row.is_unique ?? (row.Non_unique === 0 || row.unique === 1));
        const primary = Boolean(row.is_primary ?? row.Key_name === 'PRIMARY');

        if (!indexMap.has(name)) {
          indexMap.set(name, {
            name,
            columns: [],
            unique,
            type: primary ? 'PRIMARY' : 'INDEX'
          });
        }

        if (column) {
          indexMap.get(name)!.columns.push(String(column));
        }
      }

      indexes.push(...indexMap.values());
    } catch {
      // Index query failed
    }

    return indexes;
  }

  /**
   * Get foreign keys for a table
   */
  private async getForeignKeys(tableName: string): Promise<ForeignKeyInfo[]> {
    if (!this.db) throw new Error('Database not initialized');

    const client = this.db.client.config.client;
    const foreignKeys: ForeignKeyInfo[] = [];

    try {
      let query: string;

      switch (client) {
        case 'pg':
        case 'postgresql':
          query = `
            SELECT
              tc.constraint_name,
              kcu.column_name,
              ccu.table_name AS referenced_table,
              ccu.column_name AS referenced_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_name = '${tableName}'
          `;
          break;

        case 'mysql':
        case 'mysql2':
          query = `
            SELECT
              CONSTRAINT_NAME as constraint_name,
              COLUMN_NAME as column_name,
              REFERENCED_TABLE_NAME as referenced_table,
              REFERENCED_COLUMN_NAME as referenced_column
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_NAME = '${tableName}'
              AND REFERENCED_TABLE_NAME IS NOT NULL
              AND TABLE_SCHEMA = DATABASE()
          `;
          break;

        case 'sqlite3':
        case 'better-sqlite3':
          query = `PRAGMA foreign_key_list('${tableName}')`;
          break;

        default:
          return [];
      }

      const result = await this.db.raw(query);
      const rows = this.extractRows(result);

      for (const row of rows) {
        foreignKeys.push({
          constraintName: String(row.constraint_name ?? `fk_${tableName}_${String(row.from ?? '')}`),
          tableName,
          columnName: String(row.column_name ?? row.from ?? ''),
          referencedTable: String(row.referenced_table ?? row.table ?? ''),
          referencedColumn: String(row.referenced_column ?? row.to ?? ''),
          onUpdate: String(row.on_update ?? 'NO ACTION'),
          onDelete: String(row.on_delete ?? 'NO ACTION')
        });
      }
    } catch {
      // FK query failed
    }

    return foreignKeys;
  }

  /**
   * Get views
   */
  private async getViews(): Promise<ViewSchema[]> {
    if (!this.db) throw new Error('Database not initialized');

    const views: ViewSchema[] = [];

    try {
      const client = this.db.client.config.client;
      let query: string;

      switch (client) {
        case 'pg':
        case 'postgresql':
          query = `
            SELECT table_name, view_definition
            FROM information_schema.views
            WHERE table_schema = 'public'
          `;
          break;

        case 'mysql':
        case 'mysql2':
          query = `
            SELECT table_name, view_definition
            FROM information_schema.views
            WHERE table_schema = DATABASE()
          `;
          break;

        case 'sqlite3':
        case 'better-sqlite3':
          query = `
            SELECT name as table_name, sql as view_definition
            FROM sqlite_master
            WHERE type = 'view'
          `;
          break;

        default:
          return [];
      }

      const result = await this.db.raw(query);
      const rows = this.extractRows(result);

      for (const row of rows) {
        views.push({
          name: String(row.table_name ?? row.name ?? ''),
          definition: String(row.view_definition ?? row.sql ?? ''),
          columns: [] // Would need separate query
        });
      }
    } catch {
      // View query failed
    }

    return views;
  }

  /**
   * Get relationships
   */
  private async getRelationships(): Promise<RelationshipSchema[]> {
    const schema = await this.getSchema();
    const relationships: RelationshipSchema[] = [];

    for (const table of schema.tables) {
      for (const column of table.columns) {
        if (column.isForeignKey && column.references) {
          relationships.push({
            name: `${table.name}_${column.name}_fk`,
            fromTable: table.name,
            fromColumn: column.name,
            toTable: column.references.table,
            toColumn: column.references.column,
            type: 'one-to-many'
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Generate TypeScript types from schema
   */
  async generateTypes(options?: TypeGeneratorOptions): Promise<GeneratedTypes> {
    const schema = await this.getSchema();
    const warnings: string[] = [];
    const lines: string[] = [];

    lines.push('// Auto-generated database types');
    lines.push('// Generated at: ' + new Date().toISOString());
    lines.push('');

    for (const table of schema.tables) {
      const typeName = this.tableNameToTypeName(table.name);
      const exportKeyword = options?.exportFormat === 'type' ? 'type' : 'interface';

      lines.push(`export ${exportKeyword} ${typeName} ${options?.exportFormat === 'type' ? '= ' : ''}{`);

      for (const column of table.columns) {
        const tsType = this.sqlTypeToTsType(column.type);
        const optional = options?.addOptional && column.nullable ? '?' : '';
        const nullable = options?.addNullable && column.nullable ? ' | null' : '';

        lines.push(`  ${column.name}${optional}: ${tsType}${nullable};`);
      }

      lines.push('}');
      lines.push('');
    }

    return {
      typescript: lines.join('\n'),
      tableCount: schema.tables.length,
      warnings
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private parseConnectionString(connectionString?: string): DBConnection {
    if (!connectionString) {
      return {
        client: 'sqlite3',
        connection: { filename: ':memory:' }
      };
    }

    // Parse URL format
    try {
      const url = new URL(connectionString);
      const protocol = url.protocol.replace(':', '');

      const clientMap: Record<string, string> = {
        postgres: 'pg',
        postgresql: 'pg',
        mysql: 'mysql2',
        sqlite: 'sqlite3'
      };

      return {
        client: clientMap[protocol] ?? protocol,
        connection: {
          host: url.hostname,
          port: parseInt(url.port, 10) || undefined,
          user: url.username,
          password: url.password,
          database: url.pathname.slice(1)
        }
      };
    } catch {
      // Assume it's a SQLite file path
      return {
        client: 'sqlite3',
        connection: { filename: connectionString }
      };
    }
  }

  private extractRows(result: unknown): Record<string, unknown>[] {
    if (Array.isArray(result)) {
      return result.flat();
    }
    if (typeof result === 'object' && result !== null) {
      const obj = result as { rows?: unknown[] };
      if (Array.isArray(obj.rows)) {
        return obj.rows as Record<string, unknown>[];
      }
    }
    return [];
  }

  private tableNameToTypeName(tableName: string): string {
    return tableName
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('');
  }

  private sqlTypeToTsType(sqlType: string): string {
    const type = sqlType.toLowerCase();

    if (type.includes('int') || type.includes('decimal') || type.includes('numeric') ||
        type.includes('float') || type.includes('double') || type.includes('real')) {
      return 'number';
    }

    if (type.includes('bool')) {
      return 'boolean';
    }

    if (type.includes('date') || type.includes('time') || type.includes('timestamp')) {
      return 'Date';
    }

    if (type.includes('json')) {
      return 'Record<string, unknown>';
    }

    if (type.includes('array')) {
      return 'unknown[]';
    }

    if (type.includes('uuid')) {
      return 'string';
    }

    return 'string';
  }
}

export default SchemaIntrospector;
