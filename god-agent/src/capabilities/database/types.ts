/**
 * Database Types
 *
 * Type definitions specific to database introspection.
 */

export interface DBConnection {
  client: string;
  connection: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    filename?: string;
  };
}

export interface TableInfo {
  tableName: string;
  schemaName?: string;
  rowCount?: number;
  sizeBytes?: number;
}

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
  foreignKeyTable?: string;
  foreignKeyColumn?: string;
  maxLength?: number;
  numericPrecision?: number;
}

export interface IndexInfo {
  indexName: string;
  tableName: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  type: string;
}

export interface ForeignKeyInfo {
  constraintName: string;
  tableName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  onUpdate: string;
  onDelete: string;
}

export interface TypeGeneratorOptions {
  /** Include table names as type names */
  useTableNames?: boolean;
  /** Add nullable types */
  addNullable?: boolean;
  /** Add optional fields */
  addOptional?: boolean;
  /** Export format */
  exportFormat?: 'interface' | 'type' | 'class';
}
