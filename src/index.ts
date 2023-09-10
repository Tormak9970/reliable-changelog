import * as core from '@actions/core'
import path from "path";
import fs from "fs"
import { Git } from "./git";
import { generateStringChangelog } from "./generateChangelog";

/**
 * Calculates the new version using some scuffed math.
 * @param currentVersion The current version.
 * @param changelog The generated changelog.
 * @returns The new version.
 */
function calcTrueNewVersionFromLog(currentVersion: string, changelog: string): string {
  let isMajorChange = false;
  let numFixes = 0;
  let numFeats = 0;

  changelog.split("\n").forEach((logLine) => {
    if (logLine.includes("* feat: major release")) {
      isMajorChange = true;
    }
    if (logLine.includes("* feat:")) {
      numFeats++;
    } else if (logLine.includes("* fix:") || logLine.includes("* build:")) {
      numFixes++;
    }
  });

  let versions = currentVersion.split(".");
  let featsAdd = Math.ceil(numFeats / 10);

  return `${isMajorChange ? parseInt(versions[0]) + 1 : versions[0]}.${!isMajorChange ? (parseInt(versions[1]) + featsAdd) : 0}.${(!isMajorChange && featsAdd == 0) ? (parseInt(versions[2]) + Math.ceil(numFixes / 10)) : 0}`;
}

/**
 * Filters the generated changelog to be cleaner.
 * @param changelog The generated changelog.
 * @returns A filtered version of the changelog.
 */
function filterChangeLog(changelog: string): string {
  let output: string[] = [];
  let fixes: string[] = [];
  let feats: string[] = [];
  let builds: string[] = [];

  changelog.split("\n").forEach((logLine, i) => {
    if (logLine.includes("* feat:")) {
      feats.push(logLine);
    } else if (logLine.includes("* fix:")) {
      fixes.push(logLine);
    } else if (logLine.includes("* build:")) {
      builds.push(logLine);
    }
  });

  if (feats.length > 0) output.push("New Features:", ...feats, "");
  if (fixes.length > 0) output.push("Bug Fixes:", ...fixes, "");
  if (builds.length > 0) output.push("Build Pipeline Improvements:", ...builds, "");

  return output.join("\n");
}

/**
 * The main function for the action.
 * @returns Resolves when the action is complete.
 */
async function run() {
  const git = new Git();
  
  try {
    let gitCommitMessage = core.getInput('git-message');
    const gitUserName = core.getInput('git-user-name');
    const gitUserEmail = core.getInput('git-user-email');
    const gitBranch = core.getInput('git-branch').replace('refs/heads/', '');
    const tagPrefix = core.getInput('tag-prefix');
    const gitPath = "";
    const preset = 'angular';
    const prerelease = false;

    gitCommitMessage += ' [skip ci]';

    core.info(`Using "${preset}" preset`);
    core.info(`Using "${gitCommitMessage}" as commit message`);
    core.info(`Using "${gitUserName}" as git user.name`);
    core.info(`Using "${gitUserEmail}" as git user.email`);
    core.info(`Using "./package.json" as version file`);
    core.info(`Using "${tagPrefix}" as tag prefix`);
    core.info(`Using "${gitBranch}" as gitBranch`);
    core.info('Pull to make sure we have the full git history');

    await git.pull();

    const config = false;
    const packgeJsonPath = path.resolve(process.cwd(), "./package.json");
    const packageJson = JSON.parse(fs.readFileSync(packgeJsonPath).toString());

    let oldVersion = packageJson.version;
    let newVersion = `${parseInt(oldVersion.substring(0, 1)) + 1}${oldVersion.substring(1)}`;

    // Generate the string changelog
    let stringChangelog = filterChangeLog(await generateStringChangelog(tagPrefix, preset, newVersion, "1", config, gitPath, !prerelease));
    newVersion = calcTrueNewVersionFromLog(oldVersion, stringChangelog);
    let gitTag = `${tagPrefix}${newVersion}`;

    core.info(`Calculated version: "${newVersion}"`);
    core.info(`Calculated tag: "${gitTag}"`);
    core.info(`Bumping version files "./package.json"`);

    packageJson.version = newVersion;
    fs.writeFileSync(packgeJsonPath, JSON.stringify(packageJson, null, 2));

    // Removes the version number from the changelog
    const cleanChangelog = stringChangelog.trim();
    core.info('Changelog generated');
    core.info(cleanChangelog);
    core.info(`New version: ${newVersion}`);

    // Add changed files to git
    await git.add('.');
    await git.commit(gitCommitMessage.replace('{version}', gitTag));

    // Create the new tag
    await git.createTag(gitTag);

    try {
      core.info('Push all changes');
      await git.push(gitBranch);
    } catch (error: any) {
      console.error(error);
      core.setFailed(new Error(error));
      return;
    }

    // Set outputs so other actions (for example actions/create-release) can use it
    core.setOutput('clean_changelog', cleanChangelog);
    core.setOutput('version', newVersion);
    core.setOutput('tag', gitTag);
    core.setOutput('skipped', 'false');

    try {
      await core.summary
        .addHeading(gitTag, 2)
        .addRaw(cleanChangelog)
        .write();
    } catch (err) {
      core.warning(`Was unable to create summary! Error: "${err}"`);
    }
  } catch (error: any) {
    core.setFailed(new Error(error));
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
