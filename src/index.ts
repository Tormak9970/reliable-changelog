import * as core from '@actions/core'
import path from "path";
import fs from "fs"
import { Git } from "./git";
import { generateStringChangelog } from "./generateChangelog";

/**
 * Calculates the new version using some scuffed math.
 * @param currentVersion The current version.
 * @param changelog The generated changelog.
 * @param majorReleaseCommitMessage The commit message used to denote major releases.
 * @param includedTypes An array of the commit types to include.
 * @param minorCommitTypes An array of the minor version commit types.
 * @param patchCommitTypes An array of the patch version commit types.
 * @param minorCommitGroupInterval The interval at which to bump the minor version.
 * @param patchCommitGroupInterval The interval at which to bump the patch version.
 * @returns The new version.
 */
function calcTrueNewVersionFromLog(currentVersion: string, changelog: string, majorReleaseCommitMessage: string, minorCommitTypes: string[], patchCommitTypes: string[], includedTypes: string[], minorCommitGroupInterval: number, patchCommitGroupInterval: number): string {
  let isMajorChange = false;
  let numPatches = 0;
  let numMinor = 0;

  changelog.split("\n").forEach((logLine) => {
    if (logLine.includes(majorReleaseCommitMessage)) {
      isMajorChange = true;
    }
    if (logLine.includes("* feat:")) {
      numMinor++;
    } else if (logLine.includes("* fix:") || logLine.includes("* build:")) {
      numPatches++;
    }

    for (const commitType of includedTypes) {
      if (logLine.includes(`* ${commitType}:`)) {
        if (minorCommitTypes.includes(commitType)) {
          numMinor++;
        } else if (patchCommitTypes.includes(commitType)) {
          numPatches++;
        } else {
          if (commitType === "feat") {
            numMinor++;
          } else {
            numPatches++;
          }
        }
      }
    }
  });

  let versions = currentVersion.split(".");
  let minorAdded = Math.ceil(numMinor / minorCommitGroupInterval);

  return `${isMajorChange ? parseInt(versions[0]) + 1 : versions[0]}.${!isMajorChange ? (parseInt(versions[1]) + minorAdded) : 0}.${(!isMajorChange && minorAdded == 0) ? (parseInt(versions[2]) + Math.ceil(numPatches / patchCommitGroupInterval)) : 0}`;
}

/**
 * Filters the generated changelog to be cleaner.
 * @param changelog The generated changelog.
 * @param stripCommitPrefix Whether to strip the commit prefixes.
 * @param majorReleaseCommitMessage The commit message used to denote major releases.
 * @param includedTypes An array of the commit types to include.
 * @param sectionLabels A dictionary containing the section labels.
 * @returns A filtered version of the changelog.
 */
function filterChangeLog(changelog: string, stripCommitPrefix: boolean, majorReleaseCommitMessage: string, includedTypes: string[], sectionLabels: any): string {
  let output: string[] = [];
  
  const typeOutputs: any = {
    "feat": [],
    "fix": [],
    "build": [],
    "docs": [],
    "ci": [],
    "perf": [],
    "refactor": [],
    "revert": [],
    "style": [],
    "test": []
  };

  changelog.split("\n").forEach((logLine) => {
    for (const commitType of includedTypes) {
      if (logLine.includes(`* ${commitType}:`) && !logLine.includes(majorReleaseCommitMessage)) {
        typeOutputs[commitType].push(stripCommitPrefix ? `* ${logLine.substring(commitType.length + 3)}:` : logLine)
      }
    }
  });

  for (const commitType of includedTypes) {
    const typeOutput = typeOutputs[commitType];

    if (typeOutput.length > 0) output.push(sectionLabels[commitType], ...typeOutput, "");
  }

  for (const commitType of Object.keys(typeOutputs)) {
    if (typeOutputs[commitType].length > 0 && !includedTypes.includes(commitType)) {
      core.warning(`There were commits for ${commitType} but it is not included in \"includeTypes\"`);
    }
  }

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

    const currentVersion = core.getInput("current-version");

    const stripCommitPrefix = core.getBooleanInput("strip-commit-prefix");
    const majorReleaseCommitMessage = core.getInput("major-release-commit-message");
    const includeTypes = core.getInput("include-types").split(",");
    const minorCommitTypes = core.getInput("minor-commit-types").split(",");
    const minorVersionGroupInterval = parseInt(core.getInput("minor-version-group-interval"));
    const patchCommitTypes = core.getInput("patch-commit-types").split(",");
    const patchVersionGroupInterval = parseInt(core.getInput("patch-version-group-interval"));

    const sectionLabels = {
      "feat": core.getInput("feat-section-label"),
      "fix": core.getInput("fix-section-label"),
      "build": core.getInput("build-section-label"),
      "docs": core.getInput("docs-section-label"),
      "ci": core.getInput("ci-section-label"),
      "perf": core.getInput("perf-section-label"),
      "refactor": core.getInput("refactor-section-label"),
      "revert": core.getInput("revert-section-label"),
      "style": core.getInput("style-section-label"),
      "test": core.getInput("test-section-label")
    };

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
    let oldVersion: string;
    let versionJsonPath: string;
    let versionJson: any;

    if (currentVersion.startsWith("./")) {
      versionJsonPath = path.resolve(process.cwd(), currentVersion);
      versionJson = JSON.parse(fs.readFileSync(versionJsonPath).toString());
  
      oldVersion = versionJson.version;
    } else {
      oldVersion = currentVersion;
    }
    let newVersion = `${parseInt(oldVersion.substring(0, 1)) + 1}${oldVersion.substring(1)}`;

    // Generate the string changelog
    const dirtyChangelog = await generateStringChangelog(tagPrefix, preset, newVersion, "1", config, gitPath, !prerelease);
    let stringChangelog = filterChangeLog(dirtyChangelog, stripCommitPrefix, majorReleaseCommitMessage, includeTypes, sectionLabels);
    newVersion = calcTrueNewVersionFromLog(oldVersion, stringChangelog, majorReleaseCommitMessage, minorCommitTypes, patchCommitTypes, includeTypes, minorVersionGroupInterval, patchVersionGroupInterval);
    let gitTag = `${tagPrefix}${newVersion}`;

    core.info(`Calculated version: "${newVersion}"`);
    core.info(`Calculated tag: "${gitTag}"`);
    core.info(`Bumping version files "./package.json"`);

    if (versionJson) {
      versionJson.version = newVersion;
      fs.writeFileSync(versionJsonPath!, JSON.stringify(versionJson, null, 2));
    }

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
