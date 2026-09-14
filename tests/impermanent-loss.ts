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
describe("Impermanent loss", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const {
    connection,
    wallet: { payer },
  } = provider;

  const program = anchor.workspace.cp_swap as Program<CpSwap>;
  let yash = new Keypair(); // it's me

  let ammConfig = new Keypair();

  let usdc = new Keypair();
  let memeCoin = new Keypair();

  if (usdc.publicKey.toBuffer().compare(memeCoin.publicKey.toBuffer()) == 1) {
    const temp = usdc;
    usdc = memeCoin;
    memeCoin = temp;
  }
  assert(
    usdc.publicKey.toBuffer().compare(memeCoin.publicKey.toBuffer()) == -1,
  );

  const [poolPda] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("pool"),
      ammConfig.publicKey.toBuffer(),
      usdc.publicKey.toBuffer(),
      memeCoin.publicKey.toBuffer(),
    ],
    program.programId,
  );

  let payerUsdcAta = getAssociatedTokenAddressSync(
    usdc.publicKey,
    payer.publicKey,
  );
  let payerMemeCoinAta = getAssociatedTokenAddressSync(
    memeCoin.publicKey,
    payer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );

  let yashUsdcAta = getAssociatedTokenAddressSync(
    usdc.publicKey,
    yash.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );
  let yashMemeCoinAta = getAssociatedTokenAddressSync(
    memeCoin.publicKey,
    yash.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );

  let usdcPoolVault = getAssociatedTokenAddressSync(
    usdc.publicKey,
    poolPda,
    true,
    TOKEN_PROGRAM_ID,
  );

  let memeCoinPoolVault = getAssociatedTokenAddressSync(
    memeCoin.publicKey,
    poolPda,
    true,
    TOKEN_PROGRAM_ID,
  );

  let [lpMintPda] = PublicKey.findProgramAddressSync(
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
  before(async () => {
    await connection.confirmTransaction(
      await connection.requestAirdrop(yash.publicKey, LAMPORTS_PER_SOL),
    );
    let yashBalance = await connection.getBalance(yash.publicKey);
    assert.equal(yashBalance, LAMPORTS_PER_SOL);

    // Creating an Amm config
    await program.methods
      .createAmmConfig({
        disableCreatePool: false,
        swapFeeRateInBps: 0,
        updateAuthority: payer.publicKey,
        isFeeSideReceive: false,
      })
      .accounts({
        ammConfig: ammConfig.publicKey,
        creator: payer.publicKey,
      })
      .signers([payer, ammConfig])
      .rpc();

    await createMint(connection, payer, payer.publicKey, null, 6, usdc);
    await createMint(connection, payer, payer.publicKey, null, 9, memeCoin);
    await createAssociatedTokenAccount(
      connection,
      payer,
      usdc.publicKey,
      payer.publicKey,
    );

    const ata = await createAssociatedTokenAccount(
      connection,
      payer,
      memeCoin.publicKey,
      payer.publicKey,
    );

    await mintTo(
      connection,
      payer,
      usdc.publicKey,
      payerUsdcAta,
      payer.publicKey,
      250 * Math.pow(10, 6),
    ); // 250 USDC.
    await mintTo(
      connection,
      payer,
      memeCoin.publicKey,
      payerMemeCoinAta,
      payer.publicKey,
      10000 * Math.pow(10, 9),
    ); // 10000 Meme coin.

    await program.methods
      .initialize(
        new anchor.BN(25000000),
        new anchor.BN(1000000000000),
        new anchor.BN(0),
        new anchor.BN(0),
      )
      .accounts({
        ammConfig: ammConfig.publicKey,

        creator: payer.publicKey,

        creator0Token: payerUsdcAta,
        tokenProgram0: TOKEN_PROGRAM_ID,
        mint0: usdc.publicKey,

        creator1Token: payerMemeCoinAta,
        tokenProgram1: TOKEN_PROGRAM_ID,
        mint1: memeCoin.publicKey,
      })
      .rpc();
  });

  it("Simulating impermanent loss incured by Yash", async () => {
    // Creating ATAs of USDC and Meme coin for Yash.
    await createAssociatedTokenAccount(
      connection,
      yash,
      usdc.publicKey,
      yash.publicKey,
    );
    await createAssociatedTokenAccount(
      connection,
      yash,
      memeCoin.publicKey,
      yash.publicKey,
    );

    // Minting just enough to provide liquidity.
    await mintTo(
      connection,
      payer,
      usdc.publicKey,
      yashUsdcAta,
      payer.publicKey,
      25 * Math.pow(10, 6),
    ); // 25 USDC.

    await mintTo(
      connection,
      payer,
      memeCoin.publicKey,
      yashMemeCoinAta,
      payer.publicKey,
      1000 * Math.pow(10, 9),
    ); // 1000 Meme coin.

    let {
      value: { amount: usdcPoolVaultBalance },
    } = await connection.getTokenAccountBalance(usdcPoolVault);

    let {
      value: { amount: memeCoinPoolVaultBalance },
    } = await connection.getTokenAccountBalance(memeCoinPoolVault);

    let pool = await program.account.pool.fetch(poolPda);

    let usdcDeposit = new BN(usdcPoolVaultBalance);
    let memeCoinDeposit = new BN(memeCoinPoolVaultBalance);

    // Yash providing liquidity.
    await program.methods
      .deposit(usdcDeposit, memeCoinDeposit, new BN(pool.lpSupply))
      .accountsPartial({
        pool: poolPda,
        ammConfig: ammConfig.publicKey,

        lp: yash.publicKey,
        lpMint: lpMintPda,
        lpTokenAta: yashLpMintAta,

        mint0: usdc.publicKey,
        lpToken0: yashUsdcAta,
        token0Program: TOKEN_PROGRAM_ID,

        mint1: memeCoin.publicKey,
        lpToken1: yashMemeCoinAta,
        token1Program: TOKEN_PROGRAM_ID,

        token0Vault: usdcPoolVault,
        token1Vault: memeCoinPoolVault,
      })
      .signers([yash])
      .rpc();

    // 25 USDC ($25) + Spot price of Meme coin in terms of USDC * memeCoinPoolVaultBalance which is basically 2 * $25 = $50.
    const yashLiquiditySharesValueBefore = usdcDeposit.mul(new BN(2));

    for (let i = 0; i < 30; i++) {
      const trader = new Keypair();
      const traderMemoCoinAta = await createAssociatedTokenAccount(
        connection,
        payer,
        memeCoin.publicKey,
        trader.publicKey,
      );

      const {
        value: { amount: usdcPoolVaultBalanceBefore },
      } = await connection.getTokenAccountBalance(usdcPoolVault);
      const {
        value: { amount: memeCoinPoolVaultBalanceBefore },
      } = await connection.getTokenAccountBalance(memeCoinPoolVault);

      const spotPrice = new BN(memeCoinPoolVaultBalanceBefore).div(
        new BN(usdcPoolVaultBalanceBefore),
      );
      const swapAmount = Math.floor(
        spotPrice
          .mul(new BN(2))
          .add(new BN(Math.random() * 100000).mul(spotPrice))
          .toNumber(),
      ); // swapAmount is atleast 2 * spotPrice so that we atleast get 1 lamport of USDC in return.

      await mintTo(
        connection,
        payer,
        memeCoin.publicKey,
        traderMemoCoinAta,
        payer.publicKey,
        swapAmount,
      );
      const traderUsdcAta = await createAssociatedTokenAccount(
        connection,
        payer,
        usdc.publicKey,
        trader.publicKey,
      );

      await program.methods
        .swapBaseSend(new BN(swapAmount), new BN(1))
        .accountsPartial({
          pool: poolPda,
          ammConfig: ammConfig.publicKey,

          trader: trader.publicKey,

          traderSendToken: traderMemoCoinAta,
          sendTokenVault: memeCoinPoolVault,
          sendMint: memeCoin.publicKey,
          sendTokenProgram: TOKEN_PROGRAM_ID,

          traderReceiveToken: traderUsdcAta,
          receiveTokenVault: usdcPoolVault,
          receiveMint: usdc.publicKey,
          receiveTokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([trader])
        .rpc();
    }

    const {
      value: { amount: yashUsdcBalanceBeforeWithdraw },
    } = await connection.getTokenAccountBalance(yashUsdcAta);
    const {
      value: { amount: yashMemeCoinBalanceBeforeWithdraw },
    } = await connection.getTokenAccountBalance(yashMemeCoinAta);

    const {
      value: { amount: yashLpTokenBalance },
    } = await connection.getTokenAccountBalance(yashLpMintAta);

    await program.methods
      .withdraw(new BN(0), new BN(0), new BN(yashLpTokenBalance))
      .accountsPartial({
        pool: poolPda,
        ammConfig: ammConfig.publicKey,

        lp: yash.publicKey,
        lpMint: lpMintPda,
        lpTokenAta: yashLpMintAta,

        mint0: usdc.publicKey,
        lpToken0: yashUsdcAta,
        token0Vault: usdcPoolVault,
        token0Program: TOKEN_PROGRAM_ID,

        mint1: memeCoin.publicKey,
        lpToken1: yashMemeCoinAta,
        token1Vault: memeCoinPoolVault,
        token1Program: TOKEN_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();

    const {
      value: { amount: yashUsdcBalanceAfterWithdraw },
    } = await connection.getTokenAccountBalance(yashUsdcAta);
    // const {
    //   value: { amount: yashMemeCoinBalanceAfterWithdraw },
    // } = await connection.getTokenAccountBalance(yashMemeCoinAta);

    const usdcWithdraw = new BN(yashUsdcBalanceAfterWithdraw).sub(
      new BN(yashUsdcBalanceBeforeWithdraw),
    );
    // const memeCoinWithdraw = new BN(yashMemeCoinBalanceAfterWithdraw).sub(new BN(yashMemeCoinBalanceBeforeWithdraw))

    const yashLiquiditySharesValueAfter = usdcWithdraw.mul(new BN(2));

    console.log({
      impermanentLoss: `$${
        yashLiquiditySharesValueBefore
          .sub(yashLiquiditySharesValueAfter)
          .toNumber() / 1000000
      }.`,
    });
  });
});
