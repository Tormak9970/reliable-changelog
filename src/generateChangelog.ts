import conventionalChangelog from "conventional-changelog";

/**
 * Generates a changelog stream with the given arguments.
 * @param tagPrefix The tag prefix.
 * @param preset The changelog preset.
 * @param version The changelog version.
 * @param releaseCount The release count.
 * @param config The changelog config.
 * @param gitPath The git path.
 * @param skipUnstable Whether to skip unstable commits.
 * @returns The changelog stream.
 */
export function getChangelogStream(tagPrefix: string, preset: string, version: string, releaseCount: string, config: any, gitPath: string, skipUnstable: boolean = false) {
  return conventionalChangelog({
      preset,
      releaseCount: parseInt(releaseCount, 10),
      tagPrefix,
      config,
      skipUnstable
    },
    {
      version,
      // @ts-ignore
      currentTag: `${tagPrefix}${version}`,
    },
    {
      path: gitPath === '' || gitPath === null ? undefined : gitPath
    },
    config && config.parserOpts,
    config && config.writerOpts
  );
}

/**
 * Generates a string changelog
 * @param tagPrefix The tag prefix.
 * @param preset The changelog preset.
 * @param version The changelog version.
 * @param releaseCount The release count.
 * @param config The changelog config.
 * @param gitPath The git path.
 * @param skipUnstable Whether to skip unstable commits.
 * @returns A promise resolving to the changelog string.
 */
export function generateStringChangelog(tagPrefix: string, preset: string, version: string, releaseCount: string, config: any, gitPath: string, skipUnstable: boolean) {
  return new Promise<string>((resolve, reject) => {
    const changelogStream = getChangelogStream(tagPrefix, preset, version, releaseCount, config, gitPath, skipUnstable);
  
    let changelog = '';
  
    changelogStream
      .on('data', (data) => {
        changelog += data.toString();
      })
      .on('end', () => resolve(changelog));
  });
}