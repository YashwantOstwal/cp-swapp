import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { CpSwap } from "../target/types/cp_swap";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createInitializeMint2Instruction,
  createInitializeTransferFeeConfigInstruction,
  createMint,
  ExtensionType,
  getMint,
  getMintLen,
  getTransferFeeConfig,
  getExtensionData,
  initializeMint2InstructionData,
  TOKEN_2022_PROGRAM_ID,
  TransferFeeConfig,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";
describe("cpmm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const {
    connection,
    wallet: { payer },
  } = provider;

  const program = anchor.workspace.cp_swap as Program<CpSwap>;
  let yash = new Keypair();
  before(async () => {
    const sign = await connection.requestAirdrop(
      yash.publicKey,
      LAMPORTS_PER_SOL * 10,
    );
    await connection.confirmTransaction(sign);
    let yashBalance = await connection.getBalance(yash.publicKey);
    assert.equal(yashBalance, LAMPORTS_PER_SOL * 10);
  });

  let ammConfig = new Keypair();
  it("Create and update an Amm config.", async () => {
    await program.methods
      .createAmmConfig({
        disableCreatePool: false,
        swapFeeRateInBps: 3, // 0.03%
        updateAuthority: yash.publicKey,
        isFeeSideReceive: false,
      })
      .accounts({
        ammConfig: ammConfig.publicKey,
        creator: yash.publicKey,
      })
      .signers([yash, ammConfig])
      .rpc();

    const ammConfigData = await program.account.ammConfig.fetch(
      ammConfig.publicKey,
    );
    assert.equal(ammConfigData.disableCreatePool, false);
    assert.equal(ammConfigData.swapFeeRateInBps, 3);
    assert(ammConfigData.updateAuthority.equals(yash.publicKey));

    await program.methods
      .updateAmmConfig({
        ...ammConfigData,
        updateAuthority: null,
      })
      .accounts({
        ammConfig: ammConfig.publicKey,
        updateAuthority: yash.publicKey,
      })
      .signers([yash])
      .rpc();

    const ammConfigData2 = await program.account.ammConfig.fetch(
      ammConfig.publicKey,
    );
    assert.equal(ammConfigData2.disableCreatePool, false);
    assert.equal(ammConfigData2.swapFeeRateInBps, 3);
    assert.equal(ammConfigData2.updateAuthority, null);
  });

  let mint0 = new Keypair();
  let mint1 = new Keypair();

  if (mint0.publicKey.toBuffer().compare(mint1.publicKey.toBuffer()) == 1) {
    const temp = mint0;
    mint0 = mint1;
    mint1 = temp;
  }
  assert(mint0.publicKey.toBuffer().compare(mint1.publicKey.toBuffer()) == -1);

  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("pool"),
      ammConfig.publicKey.toBuffer(),
      mint0.publicKey.toBuffer(),
      mint1.publicKey.toBuffer(),
    ],
    program.programId,
  );

  let yashMint0Ata = getAssociatedTokenAddressSync(
    mint0.publicKey,
    yash.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );
  let yashMint1Ata = getAssociatedTokenAddressSync(
    mint1.publicKey,
    yash.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  let token0Vault = getAssociatedTokenAddressSync(
    mint0.publicKey,
    poolPda,
    true,
    TOKEN_PROGRAM_ID,
  );

  let token1Vault = getAssociatedTokenAddressSync(
    mint1.publicKey,
    poolPda,
    true,
    TOKEN_2022_PROGRAM_ID,
  );

  let [lpMintPda, lpMintBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp_mint"), poolPda.toBuffer()],
    program.programId,
  );
  let yashLpTokenAta = getAssociatedTokenAddressSync(
    lpMintPda,
    yash.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  const initAmount0 = 1_000;
  const grossAmount0 = initAmount0; // 10000/10.000 tokens
  const initAmount1 = 1000_000000;
  let grossAmount1 = Math.min(
    Math.ceil((1000_000000 * 10000) / (10000 - 5)),
    initAmount1 + 1000000,
  ); // max(1000500251,1001000000)  = 1000500251/1000.500251 tokens
  it("2) Creating a CPMM pool for a token and token-2022 mints referencing the previously created AMM config.", async () => {
    await createMint(connection, payer, mint0.publicKey, null, 3, mint0);
    let mint0Data = await getMint(connection, mint0.publicKey);

    let mintSize = getMintLen([ExtensionType.TransferFeeConfig]);
    let mintRent = await connection.getMinimumBalanceForRentExemption(mintSize);
    let createMint1Txn = new Transaction().add(
      SystemProgram.createAccount({
        newAccountPubkey: mint1.publicKey,
        fromPubkey: payer.publicKey,
        space: mintSize,
        lamports: mintRent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mint1.publicKey,
        mint1.publicKey,
        mint1.publicKey,
        5, // Transfer fees of 0.05% upto 1 token.
        BigInt(1000000),
      ),
      createInitializeMint2Instruction(
        mint1.publicKey,
        6,
        mint1.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    await provider.sendAndConfirm(createMint1Txn, [payer, mint1]);

    let mint1Data = await getMint(
      connection,
      mint1.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    let mint1TransferFeeConfig = getTransferFeeConfig(mint1Data);

    await createAssociatedTokenAccount(
      connection,
      payer,
      mint0.publicKey,
      yash.publicKey,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    await createAssociatedTokenAccount(
      connection,
      payer,
      mint1.publicKey,
      yash.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    await mintTo(
      connection,
      payer,
      mint0.publicKey,
      yashMint0Ata,
      mint0,
      grossAmount0 * 5,
    ); // 1.000 tokens

    await mintTo(
      connection,
      payer,
      mint1.publicKey,
      yashMint1Ata,
      mint1,
      grossAmount1 * 5,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    ); // 1000.500251 tokens

    let transferFees1 = Math.ceil((grossAmount1 * 5) / 10000);
    assert.equal(grossAmount1 - initAmount1, transferFees1);

    let {
      value: { amount: yashMint0AtaBalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint0Ata);

    let {
      value: { amount: yashMint1AtaBalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint1Ata);
    await program.methods
      .initialize(
        new anchor.BN(initAmount0),
        new anchor.BN(initAmount1),
        new anchor.BN(grossAmount0 - initAmount0),
        new anchor.BN(grossAmount1 - initAmount1),
      )
      .accounts({
        creator: yash.publicKey,
        ammConfig: ammConfig.publicKey,
        mint0: mint0.publicKey,
        tokenProgram0: TOKEN_PROGRAM_ID,
        mint1: mint1.publicKey,
        tokenProgram1: TOKEN_2022_PROGRAM_ID,
        creator0Token: yashMint0Ata,
        creator1Token: yashMint1Ata,
      })
      .signers([yash])
      .rpc();

    const {
      value: { amount: token0VaultBalance },
    } = await connection.getTokenAccountBalance(token0Vault);
    assert(new anchor.BN(token0VaultBalance).eq(new anchor.BN(initAmount0)));

    const {
      value: { amount: token1VaultBalance },
    } = await connection.getTokenAccountBalance(token1Vault);
    assert(new anchor.BN(token1VaultBalance).eq(new anchor.BN(initAmount1)));

    let poolData = await program.account.pool.fetch(poolPda);
    assert.equal(poolData.bump, poolBump);
    assert.equal(poolData.lpMintBump, lpMintBump);

    console.log(poolData);
    let liquidity = Math.sqrt(initAmount0 * initAmount1);

    assert.equal(poolData.lpSupply.toNumber(), liquidity);

    let {
      value: { amount: yashLpTokenBalance },
    } = await connection.getTokenAccountBalance(yashLpTokenAta);

    assert(new anchor.BN(yashLpTokenBalance).eqn(liquidity - 100));

    let {
      value: { amount: yashMint0AtaBalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint0Ata);

    let {
      value: { amount: yashMint1AtaBalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    assert(
      new anchor.BN(yashMint0AtaBalanceBefore)
        .sub(new anchor.BN(yashMint0AtaBalanceAfter))
        .eq(new anchor.BN(grossAmount0)),
    );

    assert(
      new anchor.BN(yashMint1AtaBalanceBefore)
        .sub(new anchor.BN(yashMint1AtaBalanceAfter))
        .eq(new anchor.BN(grossAmount1)),
    );
  });

  // Current state: Initialized a cp swap pool for mint0 (owned by Tokenkeg...) and mint1 (owned by Tokenz... with transfer fees extension enabled with transfer fees configured to 0.05% upto 1 full token) with transfer fees of 0.03%.

  it("3) Swapping 100 mint0 for mint1 ", async () => {
    await program.methods
      .swapBaseSend(new anchor.BN(100), new anchor.BN(0))
      .accountsPartial({
        sendMint: mint0.publicKey,
        sendTokenProgram: TOKEN_PROGRAM_ID,
        traderSendToken: yashMint0Ata,
        trader: yash.publicKey,
        traderReceiveToken: yashMint1Ata,
        receiveMint: mint1.publicKey,
        receiveTokenProgram: TOKEN_2022_PROGRAM_ID,
        ammConfig: ammConfig.publicKey,
        pool: poolPda,
        sendTokenVault: token0Vault,
        receiveTokenVault: token1Vault,
      })
      .signers([yash])
      .rpc();
  });

  it("Swap mint0 for 100 mint1", async () => {
    let {
      value: { amount: yashToken0BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint0Ata);

    await program.methods
      .swapBaseReceive(
        new anchor.BN(100),
        new anchor.BN(yashToken0BalanceBefore),
      )
      .accountsPartial({
        sendMint: mint0.publicKey,
        sendTokenProgram: TOKEN_PROGRAM_ID,
        traderSendToken: yashMint0Ata,
        trader: yash.publicKey,
        traderReceiveToken: yashMint1Ata,
        receiveMint: mint1.publicKey,
        receiveTokenProgram: TOKEN_2022_PROGRAM_ID,
        ammConfig: ammConfig.publicKey,
        pool: poolPda,
        sendTokenVault: token0Vault,
        receiveTokenVault: token1Vault,
      })
      .signers([yash])
      .rpc();
  });

  it("Deposit liquidity", async () => {
    let {
      value: { amount: yashToken0BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint0Ata);

    let {
      value: { amount: yashToken1BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    let pool = await program.account.pool.fetch(poolPda);
    console.log("yashToken0BalanceBefore", yashToken0BalanceBefore);
    console.log("yashToken1BalanceBefore", yashToken1BalanceBefore);
    await program.methods
      .deposit(
        new anchor.BN(yashToken0BalanceBefore),
        new anchor.BN(yashToken1BalanceBefore),
        new anchor.BN(1),
      )
      .accountsPartial({
        lp: yash.publicKey,
        lpToken0: yashMint0Ata,
        lpToken1: yashMint1Ata,
        pool: poolPda,
        token0Vault: token0Vault,
        token1Vault: token1Vault,
        lpMint: lpMintPda,
        ammConfig: ammConfig.publicKey,
        mint0: mint0.publicKey,
        token0Program: TOKEN_PROGRAM_ID,
        mint1: mint1.publicKey,
        token1Program: TOKEN_2022_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();
  });

  it("Withdraw liquidity", async () => {
    let {
      value: { amount: lpTokenBalanceBefore },
    } = await connection.getTokenAccountBalance(yashLpTokenAta);

    await program.methods
      .withdraw(new anchor.BN(0), new anchor.BN(0), new anchor.BN(1))
      .accountsPartial({
        lp: yash.publicKey,
        lpToken0: yashMint0Ata,
        lpToken1: yashMint1Ata,
        pool: poolPda,
        token0Vault: token0Vault,
        token1Vault: token1Vault,
        lpMint: lpMintPda,
        ammConfig: ammConfig.publicKey,
        mint0: mint0.publicKey,
        token0Program: TOKEN_PROGRAM_ID,
        mint1: mint1.publicKey,
        token1Program: TOKEN_2022_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();
  });
});
