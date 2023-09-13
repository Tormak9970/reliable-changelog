import conventionalChangelog from "conventional-changelog";
import type { GitRawCommitsOptions, ParserOptions, WriterOptions } from "conventional-changelog-core";
import type { Context as WriterContext } from "conventional-changelog-writer";

type OptionsConfig = {
  "parserOpts": ParserOptions,
  "writerOpts": WriterOptions
}

/**
 * Generates a changelog stream with the given arguments.
 * @param tagPrefix The tag prefix.
 * @param preset The changelog preset.
 * @param version The changelog version.
 * @param releaseCount The release count.
 * @param gitPath The git path to use.
 * @param config The changelog parser and writer config.
 * @param skipUnstable Whether to skip unstable commits.
 * @returns The changelog stream.
 */
function getChangelogStream(tagPrefix: string, preset: string, version: string, releaseCount: string, gitPath: string, config: OptionsConfig | undefined, skipUnstable: boolean) {
  const coreOptions = {
    "preset": preset,
    "releaseCount": parseInt(releaseCount, 10),
    "tagPrefix": tagPrefix,
    "config": config,
    "skipUnstable": skipUnstable
  }

  const context: Partial<WriterContext> = {
    "version": version,
    // @ts-ignore
    "currentTag": `${tagPrefix}${version}`,
  }

  const gitOptions: GitRawCommitsOptions = {
    "path": gitPath === '' || gitPath === null ? undefined : gitPath
  }

  return conventionalChangelog(coreOptions, context, gitOptions, config && config.parserOpts, config && config.writerOpts);
}

/**
 * Generates a string changelog
 * @param tagPrefix The tag prefix.
 * @param preset The changelog preset.
 * @param version The changelog version.
 * @param releaseCount The release count.
 * @param gitPath The git path to use.
 * @param config The changelog parser and writer config.
 * @param skipUnstable Whether to skip unstable commits.
 * @returns A promise resolving to the changelog string.
 */
export async function generateStringChangelog(tagPrefix: string, preset: string, version: string, releaseCount: string, gitPath: string, config: OptionsConfig | undefined, skipUnstable: boolean): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const changelogStream = getChangelogStream(tagPrefix, preset, version, releaseCount, gitPath, config, skipUnstable);
  
    let changelog = '';
  
    changelogStream
      .on('data', (data) => {
        changelog += data.toString();
      })
      .on('end', () => resolve(changelog));
  });
}