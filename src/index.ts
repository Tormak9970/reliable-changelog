import * as core from '@actions/core';
import path from "path";
import fs from "fs";
import YAML from "yaml";
import { Git } from "./git";
import { generateStringChangelog } from "./generateChangelog";

function tomlPropRegex(propertyName: string): string {
  return `/${propertyName} = \"(.*)\"/`;
}

/**
 * Calculates the new version using some scuffed math.
 * @param currentVersion The current version.
 * @param changelog The generated changelog.
 * @param majorReleaseCommitMessage The commit message used to denote major releases.
 * @param includedTypes An array of the commit types to include.
 * @param minorCommitTypes An array of the minor version commit types.
 * @param patchCommitTypes An array of the patch version commit types.
 * @param minorCommitBumpInterval The interval at which to bump the minor version.
 * @param patchCommitBumpInterval The interval at which to bump the patch version.
 * @returns The new version.
 */
function calcTrueNewVersionFromLog(currentVersion: string, changelog: string, majorReleaseCommitMessage: string, minorCommitTypes: string[], patchCommitTypes: string[], includedTypes: string[], minorCommitBumpInterval: number, patchCommitBumpInterval: number): string {
  let isMajorChange = false;
  let numPatches = 0;
  let numMinor = 0;

  changelog.split("\n").forEach((logLine) => {
    if (logLine.includes(`* ${majorReleaseCommitMessage}`)) {
      isMajorChange = true;
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
  let minorAdded = Math.ceil(numMinor / minorCommitBumpInterval);

  return `${isMajorChange ? parseInt(versions[0]) + 1 : versions[0]}.${!isMajorChange ? (parseInt(versions[1]) + minorAdded) : 0}.${(!isMajorChange && minorAdded == 0) ? (parseInt(versions[2]) + Math.ceil(numPatches / patchCommitBumpInterval)) : 0}`;
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
      if (logLine.includes(`* ${commitType}:`) && !logLine.includes(`* ${majorReleaseCommitMessage}`)) {
        let strippedCommit = logLine.substring(commitType.length + 3);
        if (strippedCommit.startsWith(" ")) strippedCommit = strippedCommit.substring(1);

        const bulletPointToPush = stripCommitPrefix ? `* ${strippedCommit}` : logLine;
        typeOutputs[commitType].push(bulletPointToPush);
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
 * Walks a json object given the needed steps, and returns the version found.
 * @param json The json object to walk.
 * @param steps The steps (properties) to traverse.
 * @returns The version value at the last property.
 */
function walkJsonToVersion(json: any, steps: string[]): string {
  let versionParent: any = JSON.parse(JSON.stringify(json));

  for (let i = 0; i < steps.length - 1; i++) {
    versionParent = versionParent[steps[i]];
  }

  const lastProperty = steps[steps.length - 1];
  if (typeof versionParent[lastProperty] !== "string") {
    core.setFailed(new Error(`Expected version property \"${lastProperty}\" to be of type \"string\" but was of type \"${typeof versionParent[lastProperty]}\".`));
  }

  return versionParent[lastProperty];
}

/**
 * Walks a json object given the needed steps, and updates the last property with the provided version.
 * @param json The json object to walk.
 * @param steps The steps (properties) to traverse.
 * @param newVersion The version to update to.
 */
function walkAndSetVersion(json: any, steps: string[], newVersion: string): void {
  let versionParent: any = json;

  for (let i = 0; i < steps.length - 1; i++) {
    versionParent = versionParent[steps[i]];
  }

  const lastProperty = steps[steps.length - 1];
  if (typeof versionParent[lastProperty] !== "string") {
    core.setFailed(new Error(`Expected version property \"${lastProperty}\" to be of type \"string\" but was of type \"${typeof versionParent[lastProperty]}\".`));
  }

  versionParent[lastProperty] = newVersion;
}

/**
 * Reads the current version and versionData from the provided version file.
 * @param versionFilePath The absolute path to the version file.
 * @param steps The array of properties that need to be read to reach the version.
 * @returns A tuple of [versionData, currentVersion].
 */
function getVersionFromFile(versionFilePath: string, steps: string[]): [any, string] {
  const extension = versionFilePath.substring(versionFilePath.lastIndexOf(".") + 1);
  const fileContentsStr = fs.readFileSync(versionFilePath).toString();
  core.info(`version path steps: ${JSON.stringify(steps)}`);

  switch(extension) {
    case "json": {
      let versionFileJson = JSON.parse(fileContentsStr);
      const version = walkJsonToVersion(versionFileJson, steps);

      return [versionFileJson, version];
    }
    case "toml": {
      const versionRegex = tomlPropRegex(steps[0]);
      const matches = fileContentsStr.match(versionRegex);

      if (matches && matches.length >= 1) {
        return [fileContentsStr, matches[1]];
      } else {
        core.setFailed(new Error(`Expected version property \"${steps[0]}\" to match regex \"${versionRegex}\" but it did not.`));
      }
    }
    case "yaml":
    case "yml": {
      const yamlJson = YAML.parse(fileContentsStr);
      const version = walkJsonToVersion(yamlJson, steps);

      return [yamlJson, version];
    }
    default: {
      core.setFailed(new Error(`Expected version file \"${versionFilePath}\" to end with \".json\", \".toml\", \".yaml\", or \".yml\", but it ended with \".${extension}\".`));
      return [null, ""];
    }
  }
}

/**
 * Updates the version file with the new version and writes those changes to the file system.
 * @param versionFilePath The absolute path to the version file.
 * @param versionData The JSON or string representation of the contents of the version file.
 * @param steps The array of properties that need to be read to reach the version.
 * @param newVersion The new version to set.
 */
function updateVersionFile(versionFilePath: string, versionData: any, steps: string[], newVersion: string): void {
  const extension = versionFilePath.substring(versionFilePath.lastIndexOf(".") + 1);

  // * We don't need a default case since this will never run if the file has an invalid extension.
  switch(extension) {
    case "json": {
      walkAndSetVersion(versionData, steps, newVersion);
      fs.writeFileSync(versionFilePath, JSON.stringify(versionData, null, 2));
      break;
    }
    case "toml": {
      const versionRegex = tomlPropRegex(steps[0]);
      const tomlAsStr = versionData as string;
      const version = tomlAsStr.match(versionRegex)![1];
      tomlAsStr.replace(version, newVersion);
      
      fs.writeFileSync(versionFilePath, versionData);
      break;
    }
    case "yaml":
    case "yml": {
      walkAndSetVersion(versionData, steps, newVersion);
      const yamlstr = YAML.stringify(versionData);
      fs.writeFileSync(versionFilePath, yamlstr);
      break;
    }
  }
}

/**
 * The main function for the action.
 * @returns Resolves when the action is complete.
 */
async function run() {
  const git = new Git();
  
  try {
    // * Read in all the inputs.
    let gitCommitMessage = core.getInput('git-message');
    const gitUserName = core.getInput('git-user-name');
    const gitUserEmail = core.getInput('git-user-email');
    const gitBranch = core.getInput('git-branch').replace('refs/heads/', '');
    const tagPrefix = core.getInput('tag-prefix');

    const currentVersion = core.getInput("current-version");
    const versionPropertyPath = core.getInput("version-path").split(".");

    const stripCommitPrefix = core.getBooleanInput("strip-commit-prefix");
    const majorReleaseCommitMessage = core.getInput("major-release-commit-message");
    const includedTypes = core.getInput("included-types").split(",");
    const minorCommitTypes = core.getInput("minor-commit-types").split(",");
    const minorVersionBumpInterval = parseInt(core.getInput("minor-version-bump-interval"));
    const patchCommitTypes = core.getInput("patch-commit-types").split(",");
    const patchVersionBumpInterval = parseInt(core.getInput("patch-version-bump-interval"));

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

    const isVersionFile = currentVersion.startsWith("./");
    const gitPath = "";
    const preset = "angular";

    gitCommitMessage += " [skip ci]";

    core.info(`Using "${preset}" preset`);
    core.info(`Using "${gitCommitMessage}" as commit message`);
    core.info(`Using "${gitUserName}" as git user.name`);
    core.info(`Using "${gitUserEmail}" as git user.email`);
    
    if (isVersionFile) core.info(`Using "${currentVersion}" as version file`);

    core.info(`Using "${tagPrefix}" as tag prefix`);
    core.info(`Using "${gitBranch}" as gitBranch`);
    core.info('Pull to make sure we have the full git history');

    await git.pull();

    let oldVersion: string;
    let versionFilePath: string;
    let versionFileContents: any;

    if (isVersionFile) {
      versionFilePath = path.resolve(process.cwd(), currentVersion);
      const [versionData, version] = getVersionFromFile(versionFilePath, versionPropertyPath);
      versionFileContents = versionData;
      oldVersion = version;
    } else {
      oldVersion = currentVersion;
    }

    let newVersion = `${parseInt(oldVersion.substring(0, 1)) + 1}${oldVersion.substring(1)}`;

    // * Generate the string changelog.
    const dirtyChangelog = await generateStringChangelog(tagPrefix, preset, newVersion, "1", gitPath, undefined, true);
    newVersion = calcTrueNewVersionFromLog(oldVersion, dirtyChangelog, majorReleaseCommitMessage, minorCommitTypes, patchCommitTypes, includedTypes, minorVersionBumpInterval, patchVersionBumpInterval);
    let stringChangelog = filterChangeLog(dirtyChangelog, stripCommitPrefix, majorReleaseCommitMessage, includedTypes, sectionLabels);
    let gitTag = `${tagPrefix}${newVersion}`;

    core.info(`Calculated version: "${newVersion}"`);
    core.info(`Calculated tag: "${gitTag}"`);

    if (isVersionFile) {
      core.info(`Bumping version file "${currentVersion}"`);
      updateVersionFile(versionFilePath!, versionFileContents, versionPropertyPath, newVersion);
    }

    // * Remove the version number from the changelog.
    const cleanChangelog = stringChangelog.trim();
    core.info('Changelog generated');
    core.info(cleanChangelog);
    core.info(`New version: ${newVersion}`);

    await git.config("user.email", gitUserEmail);
    await git.config("user.name", gitUserName);

    // * Add changed files to git
    await git.add('.');
    await git.commit(gitCommitMessage.replace('{version}', gitTag));

    // * Create a tag for the new version.
    await git.createTag(gitTag);

    try {
      core.info('Push all changes');
      await git.push(gitBranch);
    } catch (error: any) {
      console.error(error);
      core.setFailed(new Error(error));
      return;
    }

    // * Set the outputs so other actions (for example actions/create-release) can use them.
    core.setOutput('changelog', cleanChangelog);
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
