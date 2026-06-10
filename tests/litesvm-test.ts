import { createClient, generateKeyPairSigner, lamports } from "@solana/kit";
import { litesvm } from "@solana/kit-plugin-litesvm";
import { signer } from "@solana/kit-plugin-signer";
import {
  CP_SWAPP_PROGRAM_ADDRESS,
  cpSwappProgram,
} from "../src/generated/programs/cpSwapp";
import assert from "assert";
import * as fs from "fs";

async function setTestClient() {
  const mySigner = await generateKeyPairSigner();
  return createClient()
    .use(signer(mySigner))
    .use(litesvm())
    .use(cpSwappProgram());
}
describe("cp-swapp", () => {
  let client: Awaited<ReturnType<typeof setTestClient>>;

  before(async () => {
    client = await setTestClient();
    client.svm
      .withSigverify(true)
      .withBlockhashCheck(false)
      .withSysvars()
      .withBuiltins();

    const soPath =
      "/home/yashwant/Desktop/web3/cp-swapp/target/deploy/cp_swapp.so";
    assert(fs.existsSync(soPath), "Program file not found");

    client.svm.addProgramFromFile(CP_SWAPP_PROGRAM_ADDRESS, soPath);

    const programAccount = client.svm.getAccount(CP_SWAPP_PROGRAM_ADDRESS);
    assert(programAccount.exists, "Cannot load cp_swapp program");

    client.svm.airdrop(client.payer.address, lamports(1_000_000_000n));
    const balance = client.svm.getBalance(client.payer.address);
    assert(balance == lamports(1_000_000_000n), "airdrop of 1 SOL failed.");
  });

  it("Initialise", () => {
    // Create a CPMM pool with one of the mints enabled with transfer fee extension,
  });
});
