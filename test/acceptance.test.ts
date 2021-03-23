import * as core from "@actions/core";
import * as child from "child_process";
import { mocked } from "ts-jest/utils";
import { promisify } from "util";

import * as backport from "../src/backport";
import * as github from "../src/github";
import * as golden from "../src/test/constants";

jest.mock("@actions/core");
jest.mock("../src/github");
const mockedCore = mocked(core, true);
const mockedGithub = mocked(github, true);

const execPromised = promisify(child.exec);
async function exec({
  command,
  args = [],
  options = { cwd: "test" },
}: Command): Promise<Output> {
  const fullCommand = `${command} ${args?.join(" ")}`;
  const execution = execPromised(fullCommand, options);
  execution.then((ps) => {
    console.log(fullCommand);
    if (ps.stdout) console.log(ps.stdout);
    if (ps.stderr) console.log(ps.stderr);
  });
  execution.catch(console.error);
  return execution;
}

describe("given a git repository with a merged pr", () => {
  beforeEach(async () => {
    await exec({ command: "./setup.sh" });

    // print and check the history graph
    const { stdout } = await exec({
      command: "git log --graph --oneline --decorate",
      options: {
        cwd: "test/repo",
      },
    });
    expect(stdout).toContain(
      "(HEAD -> master, release-2) Merge branches 'feature-b' and 'feature-c'"
    );
  });

  describe("when backport.sh script is executed", () => {
    beforeEach(async () => {
      await exec({
        command: "./backport.sh",
        args: [
          "test/repo", // directory (repo directory)
          "feature-b", //headref (pr head)
          "master^", // baseref (pr target)
          "release-1", // target (backport onto this)
          "backport-b-to-1", // branchname (name of new backport branch)
        ],
        options: { cwd: "./" },
      });
    });

    test("then it cherry-picked all commits from the PR to backport-b-to-1", async () => {
      assertCommitsCherryPicked('feature-b', 'backport-b-to-1');
    });
  });

  describe("when github runs the action", () => {
    beforeEach(async () => {
      const token = "EB6B2C67-6298-4857-9792-280F293CAAE0";
      const pwd = "./test/project";
      const version = "0.0.2";
      mockedCore.getInput
        .mockReturnValueOnce(token)
        .mockReturnValueOnce(pwd)
        .mockReturnValueOnce(version);
      mockedGithub.getRepo.mockReturnValue(golden.repo);
      mockedGithub.getPayload.mockReturnValueOnce(golden.payloads.with_backport_label);
    });

    test.only("then it cherry-picked all commits from the PR to backport-b-to-1", async () => {
      await backport.run();
      await assertCommitsCherryPicked('feature-b', 'backport-b-to-1');
    });
  });

  afterEach(async () => {
    await exec({ command: "./cleanup.sh" });
  });
});

async function assertCommitsCherryPicked(from: string, to: string) {
  const fromLog = await exec({
    command: `git log ${from} --oneline | grep -v "init: add README.md"`,
    options: { cwd: "test/repo" },
  });
  const toLog = await exec({
    command: `git log ${to} | grep "cherry picked from"`,
    options: { cwd: "test/repo" },
  });
  fromLog.stdout
    .split("\n")
    .map((commit) => commit.split(" ")[0])
    .forEach((sha) => expect(toLog.stdout).toContain(sha));
}

type Command = {
  command: string;
  args?: string[];
  options?: child.ExecOptions;
};
type Output = { stdout: string; stderr: string };
