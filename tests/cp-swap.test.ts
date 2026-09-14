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
  getExtensionData,
  initializeMint2InstructionData,
  TOKEN_2022_PROGRAM_ID,
  TransferFeeConfig,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getTransferFeeConfig,
  calculateEpochFee,
  getEpochFee,
  MAX_FEE_BASIS_POINTS,
} from "@solana/spl-token";
import { assert } from "chai";

const { BN } = anchor;
describe("cpmm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const {
    connection,
    wallet: { payer },
  } = provider;

  const program = anchor.workspace.cp_swap as Program<CpSwap>;
  let yash = new Keypair(); // it's me
  let harsh = new Keypair();

  let alice = new Keypair();
  let bob = new Keypair();
  before(async () => {
    await connection.confirmTransaction(
      await connection.requestAirdrop(yash.publicKey, LAMPORTS_PER_SOL),
    );
    let yashBalance = await connection.getBalance(yash.publicKey);
    assert.equal(yashBalance, LAMPORTS_PER_SOL);

    await connection.confirmTransaction(
      await connection.requestAirdrop(harsh.publicKey, LAMPORTS_PER_SOL),
    );
    let harshBalance = await connection.getBalance(harsh.publicKey);
    assert.equal(harshBalance, LAMPORTS_PER_SOL);

    await connection.confirmTransaction(
      await connection.requestAirdrop(alice.publicKey, LAMPORTS_PER_SOL),
    );
    let aliceBalance = await connection.getBalance(alice.publicKey);
    assert.equal(aliceBalance, LAMPORTS_PER_SOL);

    await connection.confirmTransaction(
      await connection.requestAirdrop(bob.publicKey, LAMPORTS_PER_SOL),
    );
    let bobBalance = await connection.getBalance(yash.publicKey);
    assert.equal(bobBalance, LAMPORTS_PER_SOL);
  });

  let ammConfig = new Keypair();
  it("Creating and updating Amm config.", async () => {
    await program.methods
      .createAmmConfig({
        disableCreatePool: false,
        swapFeeRateInBps: 5, // 0.05%
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
    assert.equal(ammConfigData.isFeeSideReceive, false);
    assert.equal(ammConfigData.swapFeeRateInBps, 5);
    assert(ammConfigData.updateAuthority.equals(yash.publicKey));

    await program.methods
      .updateAmmConfig({
        ...ammConfigData,
        swapFeeRateInBps: 3, // 0.03%
        // disableCreatePool: true,
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
    assert.equal(ammConfigData2.isFeeSideReceive, false);
    assert.equal(ammConfigData2.swapFeeRateInBps, 3);
    assert(ammConfigData2.updateAuthority.equals(yash.publicKey));
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
  let yashLpMintAta = getAssociatedTokenAddressSync(
    lpMintPda,
    yash.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  function divCeil(numerator: anchor.BN, denominator: anchor.BN) {
    return numerator
      .div(denominator)
      .add(new BN(numerator.mod(denominator).cmp(new BN(0))));
  }
  async function calculatePreTransferAmount(
    transferFeeConfig: TransferFeeConfig,
    postFeeAmount: anchor.BN,
  ) {
    const { epoch } = await connection.getEpochInfo();
    const transferFee = getEpochFee(transferFeeConfig, BigInt(epoch));
    if (transferFee.transferFeeBasisPoints == 0) {
      return postFeeAmount;
    }
    if (transferFee.transferFeeBasisPoints == MAX_FEE_BASIS_POINTS) {
      return postFeeAmount.add(new BN(transferFee.maximumFee));
    } else {
      const num = postFeeAmount.mul(new BN(MAX_FEE_BASIS_POINTS));
      const den = new BN(
        MAX_FEE_BASIS_POINTS - transferFee.transferFeeBasisPoints,
      );

      let preFeeAmount = divCeil(num, den);
      const maxFees = postFeeAmount.add(new BN(transferFee.maximumFee));
      if (preFeeAmount.cmp(maxFees) == 1) {
        preFeeAmount = maxFees;
      }
      return preFeeAmount;
    }
  }
  const mint0Decimals = 6;
  const mint1Decimals = 9;
  const initAmount0 = 1000_000000;
  const grossAmount0 = initAmount0; // 1000 tokens.

  const initAmount1 = 1_000000000; // 1 token.
  const transferFeeBasisPoints1 = 5; // 0.05%
  const maxFees1 = 10000000; // 0.01 token

  const grossAmount1 = Math.min(
    Math.ceil(
      (initAmount1 * MAX_FEE_BASIS_POINTS) /
        (MAX_FEE_BASIS_POINTS - transferFeeBasisPoints1),
    ),
    initAmount1 + maxFees1,
  ); // min(1000500251,1010000000)  = 1000500251

  const expectedLiquidity = Math.floor(Math.sqrt(initAmount0 * initAmount1)); // sqrt(10_000000 * 1000_000000000)
  it("2) Creating a CPMM pool for a token and token-2022 mints referencing the previously created AMM config.", async () => {
    await createMint(
      connection,
      payer,
      mint0.publicKey,
      null,
      mint0Decimals,
      mint0,
    );
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
        transferFeeBasisPoints1, // Transfer fees of 0.05% upto 0.01 token.
        BigInt(maxFees1),
      ),
      createInitializeMint2Instruction(
        mint1.publicKey,
        mint1Decimals,
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
    assert(
      (
        await calculatePreTransferAmount(
          mint1TransferFeeConfig,
          new BN(initAmount1),
        )
      ).eq(new BN(grossAmount1)),
    );

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

    // Airdropping alott of tokens.
    await mintTo(
      connection,
      payer,
      mint0.publicKey,
      yashMint0Ata,
      mint0,
      1000000 * Math.pow(10, mint0Decimals),
    );

    await mintTo(
      connection,
      payer,
      mint1.publicKey,
      yashMint1Ata,
      mint1,
      1000000 * Math.pow(10, mint1Decimals),
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

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

    const liquidity = Math.floor(Math.sqrt(initAmount0 * initAmount1));
    assert.equal(expectedLiquidity, liquidity);
    assert.equal(poolData.lpSupply.toNumber(), liquidity);
    let {
      value: { amount: yashLpTokenBalanceAfter },
    } = await connection.getTokenAccountBalance(yashLpMintAta);

    assert(new anchor.BN(yashLpTokenBalanceAfter).eq(new BN(liquidity - 100)));

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

  // Wrong
  // Current state:
  // Initialised a pool with mint0 (3 decimals) and mint1 (6 decimals) with the pool state to be:

  // token0Vault & token1Vault balances = 1_000 & 1000_000000, pool.lpSupply = 1000000, YashLpAta balance = 999900

  // Note: The actual LP mint supply is 999900 ( 100% of the it is owned by Yash).
  // Yash has lost 100 LP tokens worth of assets to the newly created pool to provide minimum liquidity (100 tokens are locked by the pool).
  // (100 * 1_000) / 1000000 of mint0 + (100 * 1000_000000) / 1000000 of mint1 is lost by Yash.

  it("Yash withdraws half of his liquidity", async () => {
    const {
      value: { amount: yashLpAtaBalanceBefore },
    } = await connection.getTokenAccountBalance(yashLpMintAta);

    const withdrawLiquidity = new anchor.BN(yashLpAtaBalanceBefore).divRound(
      new anchor.BN(2),
    );

    const {
      value: { amount: yashToken0BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token1Vault);

    console.log(token0VaultBalanceBefore, token1VaultBalanceBefore);
    const poolBefore = await program.account.pool.fetch(poolPda);

    const expectedToken0PoolSend = new BN(withdrawLiquidity)
      .mul(new BN(token0VaultBalanceBefore))
      .div(new BN(poolBefore.lpSupply));

    const expectedToken0Receive = expectedToken0PoolSend;

    const expectedToken1PoolSend = new BN(withdrawLiquidity)
      .mul(new BN(token1VaultBalanceBefore))
      .div(new BN(poolBefore.lpSupply));

    let mint1Account = await getMint(
      connection,
      mint1.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    const mint1TransferFeeConfig = getTransferFeeConfig(mint1Account);

    const { epoch } = await connection.getEpochInfo();
    let transferFeeForPoolSend = calculateEpochFee(
      mint1TransferFeeConfig,
      BigInt(epoch),
      BigInt(expectedToken1PoolSend.toNumber()),
    );

    const expectedToken1Receive = new BN(expectedToken1PoolSend).sub(
      new BN(transferFeeForPoolSend),
    );

    await program.methods
      .withdraw(expectedToken0Receive, expectedToken1Receive, withdrawLiquidity)
      .accountsPartial({
        pool: poolPda,
        ammConfig: ammConfig.publicKey,

        lp: yash.publicKey,
        lpMint: lpMintPda,
        lpTokenAta: yashLpMintAta,

        mint0: mint0.publicKey,
        lpToken0: yashMint0Ata,
        token0Vault: token0Vault,
        token0Program: TOKEN_PROGRAM_ID,

        mint1: mint1.publicKey,
        lpToken1: yashMint1Ata,
        token1Vault: token1Vault,
        token1Program: TOKEN_2022_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();

    const poolStateAfter = await program.account.pool.fetch(poolPda);
    assert(
      new BN(poolStateAfter.lpSupply).eq(
        new BN(poolBefore.lpSupply).sub(new BN(withdrawLiquidity)),
      ),
    );
    const {
      value: { amount: yashLpAtaBalanceAfter },
    } = await connection.getTokenAccountBalance(yashLpMintAta);

    const {
      value: { amount: yashToken0BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token1Vault);

    assert(
      new BN(token0VaultBalanceBefore)
        .sub(new BN(token0VaultBalanceAfter))
        .eq(new BN(expectedToken0PoolSend)),
    );

    assert(
      new BN(token1VaultBalanceBefore)
        .sub(new BN(token1VaultBalanceAfter))
        .eq(new BN(expectedToken1PoolSend)),
    );
    assert(
      new BN(yashLpAtaBalanceBefore)
        .sub(new BN(yashLpAtaBalanceAfter))
        .eq(new BN(withdrawLiquidity)),
    );
    assert(
      new BN(yashToken0BalanceAfter)
        .sub(new BN(yashToken0BalanceBefore))
        .eq(new BN(expectedToken0Receive)),
    );
    assert(
      new BN(yashToken1BalanceAfter)
        .sub(new BN(yashToken1BalanceBefore))
        .eq(new BN(expectedToken1Receive)),
    );
  });

  it("Yash then doubles the total liquidity", async () => {
    const poolBefore = await program.account.pool.fetch(poolPda);
    const reqLpTokens = poolBefore.lpSupply;
    const {
      value: { amount: yashLpAtaBalanceBefore },
    } = await connection.getTokenAccountBalance(yashLpMintAta);
    const {
      value: { amount: yashToken0BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token1Vault);

    const expectedToken0PoolReceive = divCeil(
      new BN(reqLpTokens).mul(new BN(token0VaultBalanceBefore)),
      new BN(poolBefore.lpSupply),
    );
    const expectedToken0YashSend = expectedToken0PoolReceive;

    const expectedToken1PoolReceive = divCeil(
      new BN(reqLpTokens).mul(new BN(token1VaultBalanceBefore)),
      new BN(poolBefore.lpSupply),
    );
    let mint1Account = await getMint(
      connection,
      mint1.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    const mint1TransferFeeConfig = getTransferFeeConfig(mint1Account);

    const expectedToken1YashSend = await calculatePreTransferAmount(
      mint1TransferFeeConfig,
      expectedToken1PoolReceive,
    );
    await program.methods
      .deposit(expectedToken0YashSend, expectedToken1YashSend, reqLpTokens)
      .accountsPartial({
        pool: poolPda,
        ammConfig: ammConfig.publicKey,

        lp: yash.publicKey,
        lpMint: lpMintPda,
        lpTokenAta: yashLpMintAta,

        mint0: mint0.publicKey,
        lpToken0: yashMint0Ata,
        token0Program: TOKEN_PROGRAM_ID,

        mint1: mint1.publicKey,
        lpToken1: yashMint1Ata,
        token1Program: TOKEN_2022_PROGRAM_ID,

        token0Vault: token0Vault,
        token1Vault: token1Vault,
      })
      .signers([yash])
      .rpc();

    const poolStateAfter = await program.account.pool.fetch(poolPda);
    assert(
      new BN(poolStateAfter.lpSupply).eq(
        new BN(poolBefore.lpSupply).add(new BN(reqLpTokens)),
      ),
    );

    const {
      value: { amount: yashLpAtaBalanceAfter },
    } = await connection.getTokenAccountBalance(yashLpMintAta);

    const {
      value: { amount: yashToken0BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token1Vault);

    assert(
      new BN(token0VaultBalanceAfter)
        .sub(new BN(token0VaultBalanceBefore))
        .eq(new BN(expectedToken0PoolReceive)),
    );

    assert(
      new BN(token1VaultBalanceAfter)
        .sub(new BN(token1VaultBalanceBefore))
        .eq(new BN(expectedToken1PoolReceive)),
    );

    assert(
      new BN(yashLpAtaBalanceAfter)
        .sub(new BN(yashLpAtaBalanceBefore))
        .eq(new BN(reqLpTokens)),
    );
    assert(
      new BN(yashToken0BalanceBefore)
        .sub(new BN(yashToken0BalanceAfter))
        .eq(new BN(expectedToken0YashSend)),
    );
    assert(
      new BN(yashToken1BalanceBefore)
        .sub(new BN(yashToken1BalanceAfter))
        .eq(new BN(expectedToken1YashSend)),
    );
  });
  it("3) Yash swaps exact 5.00000 mint0 tokens for a minimum of 0.004971152 mint1 tokens, Swap fee charged on the send side (mint0)", async () => {
    const { isFeeSideReceive } = await program.account.ammConfig.fetch(
      ammConfig.publicKey,
    );
    assert(!isFeeSideReceive); // Fee side = Send.

    const {
      value: { amount: yashLpAtaBalanceBefore },
    } = await connection.getTokenAccountBalance(yashLpMintAta);
    const {
      value: { amount: yashToken0BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token1Vault);

    const signature = await program.methods
      .swapBaseSend(new anchor.BN(5000000), new anchor.BN(4971152))
      .accountsPartial({
        pool: poolPda,
        ammConfig: ammConfig.publicKey,

        trader: yash.publicKey,

        sendMint: mint0.publicKey,
        sendTokenVault: token0Vault,
        traderSendToken: yashMint0Ata,
        sendTokenProgram: TOKEN_PROGRAM_ID,

        receiveMint: mint1.publicKey,
        receiveTokenVault: token1Vault,
        traderReceiveToken: yashMint1Ata,
        receiveTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();

    // const txn = await connection.getTransaction(signature, {
    //   commitment: "confirmed",
    // });
    // console.log(txn.meta.logMessages);
    const poolAfter = await program.account.pool.fetch(poolPda);
    const {
      value: { amount: yashLpAtaBalanceAfter },
    } = await connection.getTokenAccountBalance(yashLpMintAta);
    const {
      value: { amount: yashToken0BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token1Vault);
  });
  it("3) Yash swaps a maximum of 50.093024 mint0 tokens for exact 0.005000000 mint1 tokens, Swap fee charged on the send side (mint0)", async () => {
    const { isFeeSideReceive } = await program.account.ammConfig.fetch(
      ammConfig.publicKey,
    );
    assert(!isFeeSideReceive); // Fee side = Send.

    const {
      value: { amount: yashLpAtaBalanceBefore },
    } = await connection.getTokenAccountBalance(yashLpMintAta);
    const {
      value: { amount: yashToken0BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token1Vault);

    const signature = await program.methods
      .swapBaseReceive(new anchor.BN(5000000), new anchor.BN(50093024))
      .accountsPartial({
        pool: poolPda,
        ammConfig: ammConfig.publicKey,

        trader: yash.publicKey,

        traderSendToken: yashMint0Ata,
        sendTokenVault: token0Vault,
        sendMint: mint0.publicKey,
        sendTokenProgram: TOKEN_PROGRAM_ID,

        traderReceiveToken: yashMint1Ata,
        receiveTokenVault: token1Vault,
        receiveMint: mint1.publicKey,
        receiveTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();

    // const txn = await connection.getTransaction(signature, {
    //   commitment: "confirmed",
    // });
    // console.log(txn.meta.logMessages);
    const poolAfter = await program.account.pool.fetch(poolPda);
    const {
      value: { amount: yashLpAtaBalanceAfter },
    } = await connection.getTokenAccountBalance(yashLpMintAta);
    const {
      value: { amount: yashToken0BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token1Vault);
  });

  it("3) Yash swaps exact 0.000500000 mint1 tokens for a minimum of 5.071615 mint0 tokens, Swap fee charged on the send side (mint1)", async () => {
    const { isFeeSideReceive } = await program.account.ammConfig.fetch(
      ammConfig.publicKey,
    );
    assert(!isFeeSideReceive); // Fee side = Send.

    const {
      value: { amount: yashLpAtaBalanceBefore },
    } = await connection.getTokenAccountBalance(yashLpMintAta);
    const {
      value: { amount: yashToken0BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token1Vault);
    console.log({ token0VaultBalanceBefore, token1VaultBalanceBefore });

    const signature = await program.methods
      .swapBaseSend(new anchor.BN(5000000), new anchor.BN(5071615))
      .accountsPartial({
        pool: poolPda,
        ammConfig: ammConfig.publicKey,

        trader: yash.publicKey,

        sendMint: mint1.publicKey,
        sendTokenVault: token1Vault,
        traderSendToken: yashMint1Ata,
        sendTokenProgram: TOKEN_2022_PROGRAM_ID,

        receiveMint: mint0.publicKey,
        receiveTokenVault: token0Vault,
        traderReceiveToken: yashMint0Ata,
        receiveTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();

    // const txn = await connection.getTransaction(signature, {
    //   commitment: "confirmed",
    // });
    // console.log(txn.meta.logMessages);
    const poolAfter = await program.account.pool.fetch(poolPda);
    const {
      value: { amount: yashLpAtaBalanceAfter },
    } = await connection.getTokenAccountBalance(yashLpMintAta);
    const {
      value: { amount: yashToken0BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token1Vault);
  });

  it("3) Yash swaps a maximum of 0.004979050 mint1 tokens for a exact 5.000000 mint0 tokens, Swap fee charged on the send side (mint1)", async () => {
    const { isFeeSideReceive } = await program.account.ammConfig.fetch(
      ammConfig.publicKey,
    );
    assert(!isFeeSideReceive); // Fee side = Send.

    const {
      value: { amount: yashLpAtaBalanceBefore },
    } = await connection.getTokenAccountBalance(yashLpMintAta);
    const {
      value: { amount: yashToken0BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceBefore },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceBefore },
    } = await connection.getTokenAccountBalance(token1Vault);
    // console.log({ token0VaultBalanceBefore, token1VaultBalanceBefore });

    const signature = await program.methods
      .swapBaseReceive(new anchor.BN(5000000), new anchor.BN(4979050))
      .accountsPartial({
        pool: poolPda,
        ammConfig: ammConfig.publicKey,

        trader: yash.publicKey,

        traderSendToken: yashMint1Ata,
        sendTokenVault: token1Vault,
        sendMint: mint1.publicKey,
        sendTokenProgram: TOKEN_2022_PROGRAM_ID,

        traderReceiveToken: yashMint0Ata,
        receiveTokenVault: token0Vault,
        receiveMint: mint0.publicKey,
        receiveTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();

    // const txn = await connection.getTransaction(signature, {
    //   commitment: "confirmed",
    // });
    // console.log(txn.meta.logMessages);
    const poolAfter = await program.account.pool.fetch(poolPda);
    const {
      value: { amount: yashLpAtaBalanceAfter },
    } = await connection.getTokenAccountBalance(yashLpMintAta);
    const {
      value: { amount: yashToken0BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint0Ata);
    const {
      value: { amount: yashToken1BalanceAfter },
    } = await connection.getTokenAccountBalance(yashMint1Ata);

    const {
      value: { amount: token0VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token0Vault);

    const {
      value: { amount: token1VaultBalanceAfter },
    } = await connection.getTokenAccountBalance(token1Vault);
  });

  it(":", async () => {
    await program.methods
      .updateAmmConfig({
        ...(await program.account.ammConfig.fetch(ammConfig.publicKey)),
        isFeeSideReceive: true,
      })
      .accounts({
        ammConfig: ammConfig.publicKey,
        updateAuthority: yash.publicKey,
      })
      .signers([yash])
      .rpc();

    const ammConfigState = await program.account.ammConfig.fetch(
      ammConfig.publicKey,
    );
    assert.equal(ammConfigState.disableCreatePool, false);
    assert.equal(ammConfigState.isFeeSideReceive, true);
    assert.equal(ammConfigState.swapFeeRateInBps, 3);
    assert(ammConfigState.updateAuthority.equals(yash.publicKey));
  });
});
