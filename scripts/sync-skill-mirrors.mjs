import fs from 'node:fs';
import path from 'node:path';

const isCheck = process.argv.includes('--check');
const rootDir = process.cwd();
const skillsSourceDir = path.join(rootDir, '.agents', 'skills');
const claudeSkillsDir = path.join(rootDir, '.claude', 'skills');
const notice = '<!-- GENERATED MIRROR from .agents/skills/. DO NOT EDIT DIRECTLY. Run "drakom-ai sync ." through your package runner to update. -->';

if (!fs.existsSync(skillsSourceDir)) {
  console.error(`Missing skills directory: ${skillsSourceDir}`);
  process.exit(1);
}

const entries = fs.readdirSync(skillsSourceDir, { withFileTypes: true });
const skillDirs = entries.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name);
const canonicalSkills = skillDirs
  .map((dirName) => ({
    dirName,
    sourceFile: path.join(skillsSourceDir, dirName, 'SKILL.md'),
    targetDir: path.join(claudeSkillsDir, dirName),
  }))
  .filter(({ sourceFile }) => fs.existsSync(sourceFile))
  .map((skill) => ({
    ...skill,
    targetFile: path.join(skill.targetDir, 'SKILL.md'),
    sourceContent: fs.readFileSync(skill.sourceFile, 'utf8'),
  }));

/** @param {string} content */
function isGeneratedMirrorContent(content) {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  const body = frontmatter ? content.slice(frontmatter.length).replace(/^(?:\r?\n)*/, '') : content;
  return body === notice || body.startsWith(`${notice}\n`) || body.startsWith(`${notice}\r\n`);
}

/** @param {string} content */
function createMirrorContent(content) {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0];
  if (!frontmatter) return `${notice}\n\n${content}`;

  return `${frontmatter}\n${notice}\n\n${content.slice(frontmatter.length)}`;
}

/** @param {string} skillDir */
function isGeneratedMirror(skillDir) {
  const skillFile = path.join(claudeSkillsDir, skillDir, 'SKILL.md');
  return fs.existsSync(skillFile) && isGeneratedMirrorContent(fs.readFileSync(skillFile, 'utf8'));
}

const collisions = canonicalSkills.filter(({ targetDir, targetFile }) => {
  if (!fs.existsSync(targetDir)) return false;
  return !fs.existsSync(targetFile) || !isGeneratedMirrorContent(fs.readFileSync(targetFile, 'utf8'));
});

if (collisions.length > 0) {
  for (const { targetDir } of collisions) {
    console.error(`[COLLISION] Refusing to overwrite hand-authored Claude skill: ${path.relative(rootDir, targetDir)}`);
  }
  console.error('\nResolve these skill-name collisions before synchronizing mirrors. No files were changed.');
  process.exit(1);
}

let hasDrift = false;

for (const { targetDir, targetFile, sourceContent } of canonicalSkills) {
  const expectedContent = createMirrorContent(sourceContent);

  if (isCheck) {
    if (!fs.existsSync(targetFile)) {
      console.error(`[DRIFT] Missing Claude skill mirror: ${path.relative(rootDir, targetFile)}`);
      hasDrift = true;
    } else if (fs.readFileSync(targetFile, 'utf8') !== expectedContent) {
      console.error(`[DRIFT] Skill mirror out of sync: ${path.relative(rootDir, targetFile)}`);
      hasDrift = true;
    }
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetFile, expectedContent, 'utf8');
    console.log(`Synced skill mirror: ${path.relative(rootDir, targetFile)}`);
  }
}

// Detect stale mirrors without touching Claude-only skills. A generated SKILL.md is
// removed while any supporting files in that directory remain intact.
if (fs.existsSync(claudeSkillsDir)) {
  const mirrorEntries = fs.readdirSync(claudeSkillsDir, { withFileTypes: true });
  const mirrorDirs = mirrorEntries.filter((d) => d.isDirectory()).map((d) => d.name);
  const canonicalSet = new Set(canonicalSkills.map(({ dirName }) => dirName));

  for (const mirrorName of mirrorDirs) {
    if (!canonicalSet.has(mirrorName) && isGeneratedMirror(mirrorName)) {
      const stalePath = path.join(claudeSkillsDir, mirrorName);
      const staleSkillFile = path.join(stalePath, 'SKILL.md');
      if (isCheck) {
        console.error(`[DRIFT] Stale Claude skill mirror (no canonical source): ${path.relative(rootDir, stalePath)}`);
        hasDrift = true;
      } else {
        fs.rmSync(staleSkillFile);
        if (fs.readdirSync(stalePath).length === 0) fs.rmdirSync(stalePath);
        console.log(`Removed stale mirror: ${path.relative(rootDir, staleSkillFile)}`);
      }
    }
  }
}

if (isCheck && hasDrift) {
  console.error('\nSkill mirror drift detected. Run "drakom-ai sync ." through your package runner to synchronize mirrors.');
  process.exit(1);
}
