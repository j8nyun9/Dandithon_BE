// Read the explicitly supplied demo list from an ignored local file.
import {readFileSync} from 'node:fs';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import pg from 'pg';
if(!process.env.DATABASE_URL) throw Error('DATABASE_URL이 필요합니다.');
const students=JSON.parse(readFileSync('.demo-students.json','utf8'));
if(!Array.isArray(students)||students.length!==25||new Set(students.map(s=>s.email)).size!==25||students.some(s=>!/^student\d{2}@demo\.local$/.test(s.email)||typeof s.name!=='string'||!s.name.trim()||!Number.isInteger(s.school_id)||s.school_id<1||s.school_id>5)) throw Error('시연 학생 목록을 확인해 주세요.');
const password='DemoStudent!123';
const hash=(p,s=randomBytes(16).toString('hex'))=>`${s}:${scryptSync(p,s,64).toString('hex')}`;
const verify=(p,h)=>{const [s,v]=h.split(':');const a=Buffer.from(hash(p,s).split(':')[1],'hex'),b=Buffer.from(v||'','hex');return a.length===b.length&&timingSafeEqual(a,b);};
const db=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});
try {
 await db.connect();await db.query('BEGIN');await db.query('SET LOCAL search_path TO public');
 const schools=await db.query('SELECT id,name FROM schools ORDER BY id');
 const expected=['경북대학교','영남대학교','계명대학교','금오공과대학교','대구대학교'];
 if(expected.some((name,i)=>!schools.rows.some(s=>s.id===i+1&&s.name===name))) throw Error('학교 번호와 이름이 일치하지 않습니다.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const semesters=await db.query('SELECT id FROM semesters WHERE start_at<=$1 AND end_at>=$1 ORDER BY start_at DESC',[today]);
 if(semesters.rowCount!==1) throw Error('현재 학기를 하나로 확정할 수 없습니다.');
 const semesterId=semesters.rows[0].id;
 await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT');
 for(const student of students){
  const existing=await db.query('SELECT id,role,school_id,password_hash FROM users WHERE email=$1',[student.email]);
  let id;
  if(existing.rowCount){const user=existing.rows[0];if(user.role!=='student'||user.school_id!==student.school_id||!verify(password,user.password_hash)) throw Error('기존 계정과 입력 목록이 충돌합니다.');id=user.id;await db.query('UPDATE users SET name=$1 WHERE id=$2',[student.name,id]);}
  else {const inserted=await db.query("INSERT INTO users(email,password_hash,role,school_id,name) VALUES($1,$2,'student',$3,$4) RETURNING id",[student.email,hash(password),student.school_id,student.name]);id=inserted.rows[0].id;}
  await db.query('INSERT INTO enrollments(user_id,semester_id,school_id) VALUES($1,$2,$3) ON CONFLICT(user_id,semester_id) DO NOTHING',[id,semesterId,student.school_id]);
  const enrollment=await db.query('SELECT school_id FROM enrollments WHERE user_id=$1 AND semester_id=$2',[id,semesterId]);
  if(enrollment.rows[0]?.school_id!==student.school_id) throw Error('기존 학기 등록 학교와 입력 목록이 충돌합니다.');
 }
 const admin=await db.query("UPDATE users SET name=$1 WHERE email=$2 AND role='admin'",['단디 관리자','admin@demo.local']);
 if(admin.rowCount!==1)throw Error('기존 관리자 계정을 찾지 못했습니다.');
 await db.query('COMMIT');console.log('학생 25명의 계정과 학기 등록을 확인했습니다. 기존 관리자 비밀번호는 유지했습니다.');
} catch(error){await db.query('ROLLBACK').catch(()=>{});console.error('등록을 완료하지 못했습니다:',String(error.message||'오류').replaceAll(process.env.DATABASE_URL,'[redacted]'));process.exitCode=1;}
finally{await db.end().catch(()=>{});}
