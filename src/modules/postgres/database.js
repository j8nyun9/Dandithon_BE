import pg from 'pg';

// Transactions receive their own client; concurrent requests must never share one.
export function createPostgresDatabase(connectionString, options = {}) {
 if (!connectionString) throw new Error('DATABASE_URL이 필요합니다.');
 const pool = new pg.Pool({connectionString, ssl:{rejectUnauthorized:true}, max:options.max ?? 3, connectionTimeoutMillis:10000, idleTimeoutMillis:10000});
 const query = (sql, values=[]) => pool.query(sql,values);
 async function transaction(fn) {
  const client=await pool.connect();
  try {
   await client.query('BEGIN');
   const value=await fn((sql,values=[])=>client.query(sql,values));
   await client.query('COMMIT');
   return value;
  } catch(error) {
   await client.query('ROLLBACK').catch(()=>{});
   throw error;
  } finally { client.release(); }
 }
 return {query,transaction,close:()=>pool.end()};
}
