const DatabaseConnection = require('../server/database/connection');
const DatabaseSchema = require('../server/database/schema');
const path = require('path');

describe('Database Connection', () => {
  let connection;

  beforeEach(() => {
    connection = new DatabaseConnection();
    // Use in-memory database for testing
    connection.dbPath = ':memory:';
  });

  afterEach(async () => {
    if (connection.db) {
      await connection.close();
    }
  });

  test('should connect to database successfully', async () => {
    await expect(connection.connect()).resolves.toBeUndefined();
    expect(connection.db).toBeDefined();
  });

  test('should close database connection', async () => {
    await connection.connect();
    await expect(connection.close()).resolves.toBeUndefined();
    // Reset connection for next test
    connection.db = null;
  });

  test('should execute run queries', async () => {
    await connection.connect();
    const result = await connection.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('changes');
  });

  test('should execute get queries', async () => {
    await connection.connect();
    await connection.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    await connection.run('INSERT INTO test (name) VALUES (?)', ['test']);
    
    const row = await connection.get('SELECT * FROM test WHERE name = ?', ['test']);
    expect(row).toHaveProperty('id');
    expect(row.name).toBe('test');
  });

  test('should execute all queries', async () => {
    await connection.connect();
    await connection.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    await connection.run('INSERT INTO test (name) VALUES (?)', ['test1']);
    await connection.run('INSERT INTO test (name) VALUES (?)', ['test2']);
    
    const rows = await connection.all('SELECT * FROM test');
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('test1');
    expect(rows[1].name).toBe('test2');
  });

  test('should handle database errors gracefully', async () => {
    await connection.connect();
    await expect(connection.run('INVALID SQL')).rejects.toThrow();
  });
});

describe('Database Schema', () => {
  let schema;

  beforeEach(() => {
    schema = new DatabaseSchema();
    // Use in-memory database for testing
    schema.connection.dbPath = ':memory:';
  });

  afterEach(async () => {
    await schema.close();
  });

  test('should initialize schema successfully', async () => {
    await expect(schema.initialize()).resolves.toBeUndefined();
  });

  test('should create all required tables', async () => {
    await schema.initialize();
    
    // Check if tables exist
    const tables = await schema.connection.all(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('badge_jobs');
    expect(tableNames).toContain('templates');
    expect(tableNames).toContain('printer_configurations');
  });

  test('should create indexes', async () => {
    await schema.initialize();
    
    // Check if indexes exist
    const indexes = await schema.connection.all(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    );
    
    expect(indexes.length).toBeGreaterThan(0);
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_badge_jobs_status');
    expect(indexNames).toContain('idx_badge_jobs_uid');
  });
});