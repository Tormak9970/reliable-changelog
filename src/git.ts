import core from "@actions/core"
import exec from "@actions/exec"

const { GITHUB_REPOSITORY, ENV } = process.env;

export class Git {
  commandsRun: string[] = [];

  constructor() {
    const githubToken = core.getInput('github-token');

    // Make the Github token secret
    core.setSecret(githubToken);

    // if the env is dont-use-git then we mock exec as we are testing a workflow
    if (ENV === 'dont-use-git') {
      this.exec = async (command) => {
        const fullCommand = `git ${command}`;
        
        console.log(`Skipping "${fullCommand}" because of test env`);
        
        if (!fullCommand.includes('git remote set-url origin')) {
          this.commandsRun.push(fullCommand);
        }
      }
    }
  }

  /**
   * Initializes the Git helper class.
   */
  init = async () => {
    const gitUserName = core.getInput('git-user-name');
    const gitUserEmail = core.getInput('git-user-email');
    const gitUrl = core.getInput('git-url');
    const githubToken = core.getInput('github-token');

    // Set config
    await this.config('user.name', gitUserName);
    await this.config('user.email', gitUserEmail);

    // Update the origin
    if (githubToken) {
      await this.updateOrigin(`https://x-access-token:${githubToken}@${gitUrl}/${GITHUB_REPOSITORY}.git`);
    }
  }

  /**
   * Runs a command.
   * @param command The command to execute.
   * @returns A promise resolving to the result of the command.
   */
  exec = (command: string) => new Promise(async (resolve, reject) => {
    let execOutput = '';

    const options = {
      listeners: {
        stdout: (data: any) => {
          execOutput += data.toString();
        },
      },
    }

    const exitCode = await exec.exec(`git ${command}`, undefined, options);

    if (exitCode === 0) {
      resolve(execOutput);

    } else {
      reject(`Command "git ${command}" exited with code ${exitCode}.`);
    }
  });

  /**
   * Sets a git config property to the provided value.
   * @param prop The property to set.
   * @param value The value to set it to.
   */
  async config(prop: string, value: string) {
    await this.exec(`config ${prop} "${value}"`);
  }

  /**
   * Adds a file to the next git commit.
   * @param file The path of the file to add.
   */
  async add(file: string) {
    await this.exec(`add ${file}`);
  }

  /**
   * Commits all staged changes.
   * @param message The commit message.
   */
  async commit(message: string) {
    await this.exec(`commit -m "${message}"`);
  }

  /**
   * Pulls any changes from the remote branch.
   */
  async pull() {
    const args = ['pull'];

    // Check if the repo is unshallow
    if (await this.isShallow()) {
      args.push('--unshallow');
    }

    args.push('--tags');
    args.push(core.getInput('git-pull-method'));

    return this.exec(args.join(' '));
  }

  /**
   * Pushes all staged commits to the provided branch.
   * @param branch The branch to push to.
   */
  async push(branch: string) {
    this.exec(`push origin ${branch} --follow-tags`);
  }

  /**
   * Checks if the repo is shallow.
   * @returns True if it is, false if not.
   */
  async isShallow() {
    if (ENV === 'dont-use-git') {
      return false;
    }

    const isShallow = (await this.exec('rev-parse --is-shallow-repository')) as string;

    return isShallow.trim().replace('\n', '') === 'true';
  }

  /**
   * Updates the origin being used.
   * @param repo The repo to update to.
   */
  async updateOrigin(repo: string) {
    await this.exec(`remote set-url origin ${repo}`);
  }

  /**
   * Creates a new git tag.
   * @param tag The tag to create.
   */
  async createTag(tag: string) {
    await this.exec(`tag -a ${tag} -m "${tag}"`);
  }
}
