import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync} from 'node:crypto';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
const path=resolve(process.env.DB_PATH||'dandi.sqlite');
if(!existsSync(path)) throw Error('기존 DB가 없습니다. npm run seed를 사용하세요.');
const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');
const backup=resolve(`school-migration-backup-${Date.now()}.sqlite`);
db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);
const get=(q,...p)=>db.prepare(q).get(...p),run=(q,...p)=>db.prepare(q).run(...p);
const hash=p=>{const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(p,salt,64).toString('hex')}`;};
const schools=['경북대학교','영남대학교','계명대학교','금오공과대학교','대구대학교'], codes=['knu','ynu','kmu','kumoh','daegu'];
db.exec('BEGIN IMMEDIATE');try{
 const old=get('SELECT id FROM users WHERE email=?','student@demo.local');
 if(old){run('DELETE FROM events WHERE user_id=?',old.id);run('DELETE FROM verifications WHERE user_id=?',old.id);run('UPDATE verifications SET reviewed_by=NULL WHERE reviewed_by=?',old.id);run('DELETE FROM audit_log WHERE actor_id=? OR user_id=?',old.id,old.id);run('DELETE FROM enrollments WHERE user_id=?',old.id);run('DELETE FROM users WHERE id=?',old.id);}
 for(const [i,name] of schools.entries()){
  run('INSERT OR IGNORE INTO schools(name) VALUES(?)',name);const school=get('SELECT id FROM schools WHERE name=?',name);
  const email=`${codes[i]}@demo.local`;let user=get('SELECT id,role,school_id FROM users WHERE email=?',email);
  if(user && (user.role!=='student'||user.school_id!==school.id)) throw Error(`${email}: 기존 계정과 충돌`);
  if(!user){const inserted=run('INSERT INTO users(email,password_hash,role,school_id) VALUES(?,?,?,?)',email,hash('DemoStudent!123'),'student',school.id);user={id:Number(inserted.lastInsertRowid)};}
  run('INSERT OR IGNORE INTO enrollments(user_id,semester_id,school_id) VALUES(?,?,?)',user.id,1,school.id);
 }
 for(const oldName of ['대구 시연대학교','경북 시연대학교']){const oldSchool=get('SELECT id FROM schools WHERE name=?',oldName);if(oldSchool){if(get('SELECT COUNT(*) n FROM users WHERE school_id=?',oldSchool.id).n||get('SELECT COUNT(*) n FROM enrollments WHERE school_id=?',oldSchool.id).n)throw Error(`${oldName}에 다른 참가자가 남아 있습니다.`);run('DELETE FROM schools WHERE id=?',oldSchool.id);}}
 // Hide only the original built-in mock, leaving administrator-created missions untouched.
 const cols=db.prepare('PRAGMA table_info(missions)').all().map(c=>c.name);
 if(!cols.includes('archived_at')) db.exec('ALTER TABLE missions ADD COLUMN archived_at TEXT');
 run("UPDATE missions SET status='closed',archived_at=CURRENT_TIMESTAMP WHERE id=1 AND title='시연 교육 멘토링' AND notice='가상 공고: 실제 모집이 아닙니다.' AND source_url='https://example.org/notice'");
 db.exec('COMMIT');console.log('학교 계정 적용 완료. 기존 DB 백업:',backup);
}catch(e){db.exec('ROLLBACK');console.error('변경을 취소했습니다. 백업:',backup);throw e;}finally{db.close();}
