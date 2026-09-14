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
describe("Demonstrating: Price impact in Receive token ∝ Amount of Send token swapped / Amount of Send tokens in the Pool.", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const {
    connection,
    wallet: { payer },
  } = provider;

  const program = anchor.workspace.cp_swap as Program<CpSwap>;
  let yash = new Keypair(); // it's me

  let sendMint = new Keypair();
  let receiveMint = new Keypair();

  if (
    sendMint.publicKey.toBuffer().compare(receiveMint.publicKey.toBuffer()) == 1
  ) {
    const temp = sendMint;
    sendMint = receiveMint;
    receiveMint = temp;
  }
  assert(
    sendMint.publicKey.toBuffer().compare(receiveMint.publicKey.toBuffer()) ==
      -1,
  );

  let payerSendMintAta = getAssociatedTokenAddressSync(
    sendMint.publicKey,
    payer.publicKey,
  );
  let payerReceiveMintAta = getAssociatedTokenAddressSync(
    receiveMint.publicKey,
    payer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );

  let yashSendMintAta = getAssociatedTokenAddressSync(
    sendMint.publicKey,
    yash.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );
  let yashReceiveMintAta = getAssociatedTokenAddressSync(
    receiveMint.publicKey,
    yash.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );

  function divCeil(numerator: anchor.BN, denominator: anchor.BN) {
    return numerator
      .div(denominator)
      .add(new BN(numerator.mod(denominator).cmp(new BN(0))));
  }

  async function setUpPool(initAmountSend: number, initAmountReceive: number) {
    const ammConfig = new Keypair();
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
      .signers([ammConfig])
      .rpc();
    await mintTo(
      connection,
      payer,
      sendMint.publicKey,
      payerSendMintAta,
      payer.publicKey,
      initAmountSend,
    );
    await mintTo(
      connection,
      payer,
      receiveMint.publicKey,
      payerReceiveMintAta,
      payer.publicKey,
      initAmountReceive,
    );

    await program.methods
      .initialize(
        new anchor.BN(initAmountSend),
        new anchor.BN(initAmountReceive),
        new anchor.BN(0),
        new anchor.BN(0),
      )
      .accounts({
        ammConfig: ammConfig.publicKey,

        creator: payer.publicKey,

        creator0Token: payerSendMintAta,
        tokenProgram0: TOKEN_PROGRAM_ID,
        mint0: sendMint.publicKey,

        creator1Token: payerReceiveMintAta,
        tokenProgram1: TOKEN_PROGRAM_ID,
        mint1: receiveMint.publicKey,
      })
      .rpc();

    const [poolPda] = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode("pool"),
        ammConfig.publicKey.toBuffer(),
        sendMint.publicKey.toBuffer(),
        receiveMint.publicKey.toBuffer(),
      ],
      program.programId,
    );
    let sendMintPoolVault = getAssociatedTokenAddressSync(
      sendMint.publicKey,
      poolPda,
      true,
      TOKEN_PROGRAM_ID,
    );

    let receiveMintPoolVault = getAssociatedTokenAddressSync(
      receiveMint.publicKey,
      poolPda,
      true,
      TOKEN_PROGRAM_ID,
    );
    return {
      ammConfig: ammConfig.publicKey,
      poolPda,
      sendMintPoolVault,
      receiveMintPoolVault,
    };
  }
  before(async () => {
    await connection.confirmTransaction(
      await connection.requestAirdrop(yash.publicKey, LAMPORTS_PER_SOL),
    );
    let yashBalance = await connection.getBalance(yash.publicKey);
    assert.equal(yashBalance, LAMPORTS_PER_SOL);

    await createMint(connection, payer, payer.publicKey, null, 0, sendMint);
    await createMint(connection, payer, payer.publicKey, null, 0, receiveMint);
    await createAssociatedTokenAccount(
      connection,
      payer,
      sendMint.publicKey,
      payer.publicKey,
    );

    await createAssociatedTokenAccount(
      connection,
      payer,
      receiveMint.publicKey,
      payer.publicKey,
    );

    await createAssociatedTokenAccount(
      connection,
      yash,
      sendMint.publicKey,
      yash.publicKey,
    );
    await createAssociatedTokenAccount(
      connection,
      yash,
      receiveMint.publicKey,
      yash.publicKey,
    );

    // Airdropping some Send tokens later used for swapping.
    await mintTo(
      connection,
      payer,
      sendMint.publicKey,
      yashSendMintAta,
      payer.publicKey,
      20000,
    );
  });

  it("1", async () => {
    const {
      ammConfig: ammConfig0Pubkey,
      poolPda: pool0Pda,
      sendMintPoolVault: sendMintPool0Vault,
      receiveMintPoolVault: receiveMintPool0Vault,
    } = await setUpPool(1000000, 10000000);
    const {
      ammConfig: ammConfig1Pubkey,
      poolPda: pool1Pda,
      sendMintPoolVault: sendMintPool1Vault,
      receiveMintPoolVault: receiveMintPool1Vault,
    } = await setUpPool(1000000, 10000000);

    const {
      value: { amount: sendMintPool0Amount },
    } = await connection.getTokenAccountBalance(sendMintPool0Vault);

    const {
      value: { amount: receiveMintPool0Amount },
    } = await connection.getTokenAccountBalance(receiveMintPool0Vault);

    // Scaling the spot price by multiplying it with 1000 to store the fractional part in the last 3 digits of the integer.
    const spotPrice0 = new BN(receiveMintPool0Amount)
      .mul(new BN(1000))
      .div(new BN(sendMintPool0Amount));

    const {
      value: { amount: yashReceiveMint0TokenAmountBeforeSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const swapAmount0 = new BN(1000);
    await program.methods
      .swapBaseSend(swapAmount0, swapAmount0)
      .accountsPartial({
        pool: pool0Pda,
        ammConfig: ammConfig0Pubkey,

        trader: yash.publicKey,

        sendMint: sendMint.publicKey,
        sendTokenVault: sendMintPool0Vault,
        traderSendToken: yashSendMintAta,
        sendTokenProgram: TOKEN_PROGRAM_ID,

        receiveMint: receiveMint.publicKey,
        receiveTokenVault: receiveMintPool0Vault,
        traderReceiveToken: yashReceiveMintAta,
        receiveTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();
    const {
      value: { amount: yashReceiveMint0TokenAmountAfterSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const sendAmount0 = swapAmount0;
    const receiveAmount0 = new BN(yashReceiveMint0TokenAmountAfterSwap).sub(
      new BN(yashReceiveMint0TokenAmountBeforeSwap),
    );

    const executionPrice0 = new anchor.BN(receiveAmount0)
      .mul(new BN(1000))
      .div(new anchor.BN(sendAmount0));

    // -----
    const {
      value: { amount: yashReceiveMint1TokenAmountBeforeSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const {
      value: { amount: sendMintPool1Amount },
    } = await connection.getTokenAccountBalance(sendMintPool1Vault);
    const {
      value: { amount: receiveMintPool1Amount },
    } = await connection.getTokenAccountBalance(receiveMintPool1Vault);

    const spotPrice1 = new BN(receiveMintPool1Amount)
      .mul(new BN(1000))
      .div(new BN(sendMintPool1Amount));

    const swapAmount1 = new BN(2000);
    await program.methods
      .swapBaseSend(swapAmount1, swapAmount1)
      .accountsPartial({
        pool: pool1Pda,
        ammConfig: ammConfig1Pubkey,

        trader: yash.publicKey,

        sendMint: sendMint.publicKey,
        sendTokenVault: sendMintPool1Vault,
        traderSendToken: yashSendMintAta,
        sendTokenProgram: TOKEN_PROGRAM_ID,

        receiveMint: receiveMint.publicKey,
        receiveTokenVault: receiveMintPool1Vault,
        traderReceiveToken: yashReceiveMintAta,
        receiveTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();

    const {
      value: { amount: yashReceiveMint1TokenAmountAfterSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const sendAmount1 = swapAmount1;
    const receiveAmount1 = new BN(yashReceiveMint1TokenAmountAfterSwap).sub(
      new BN(yashReceiveMint1TokenAmountBeforeSwap),
    );

    const executionPrice1 = new anchor.BN(receiveAmount1)
      .mul(new anchor.BN(1000))
      .div(new anchor.BN(sendAmount1));

    let priceImpact0 = spotPrice0.sub(executionPrice0);
    let priceImpact1 = spotPrice1.sub(executionPrice1);

    assert(priceImpact0.lt(priceImpact1)); // Price impact is directly proportional to the amount swapped when the reserves of the pool are equal.
  });

  it("2", async () => {
    const {
      ammConfig: ammConfig0Pubkey,
      poolPda: pool0Pda,
      sendMintPoolVault: sendMintPool0Vault,
      receiveMintPoolVault: receiveMintPool0Vault,
    } = await setUpPool(1000000, 10000000);
    const {
      ammConfig: ammConfig1Pubkey,
      poolPda: pool1Pda,
      sendMintPoolVault: sendMintPool1Vault,
      receiveMintPoolVault: receiveMintPool1Vault,
    } = await setUpPool(2000000, 20000000);

    const {
      value: { amount: sendMintPool0Amount },
    } = await connection.getTokenAccountBalance(sendMintPool0Vault);

    const {
      value: { amount: receiveMintPool0Amount },
    } = await connection.getTokenAccountBalance(receiveMintPool0Vault);

    const spotPrice0 = new BN(receiveMintPool0Amount)
      .mul(new BN(1000))
      .div(new BN(sendMintPool0Amount));

    const {
      value: { amount: yashReceiveMint0TokenAmountBeforeSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const swapAmount = new BN(1000);
    await program.methods
      .swapBaseSend(swapAmount, swapAmount)
      .accountsPartial({
        pool: pool0Pda,
        ammConfig: ammConfig0Pubkey,

        trader: yash.publicKey,

        sendMint: sendMint.publicKey,
        sendTokenVault: sendMintPool0Vault,
        traderSendToken: yashSendMintAta,
        sendTokenProgram: TOKEN_PROGRAM_ID,

        receiveMint: receiveMint.publicKey,
        receiveTokenVault: receiveMintPool0Vault,
        traderReceiveToken: yashReceiveMintAta,
        receiveTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();
    const {
      value: { amount: yashReceiveMint0TokenAmountAfterSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const sendAmount0 = swapAmount;
    const receiveAmount0 = new BN(yashReceiveMint0TokenAmountAfterSwap).sub(
      new BN(yashReceiveMint0TokenAmountBeforeSwap),
    );

    const executionPrice0 = new anchor.BN(receiveAmount0)
      .mul(new BN(1000))
      .div(new anchor.BN(sendAmount0));

    // -----
    const {
      value: { amount: yashReceiveMint1TokenAmountBeforeSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const {
      value: { amount: sendMintPool1Amount },
    } = await connection.getTokenAccountBalance(sendMintPool1Vault);
    const {
      value: { amount: receiveMintPool1Amount },
    } = await connection.getTokenAccountBalance(receiveMintPool1Vault);

    const spotPrice1 = new BN(receiveMintPool1Amount)
      .mul(new BN(1000))
      .div(new BN(sendMintPool1Amount));

    await program.methods
      .swapBaseSend(swapAmount, swapAmount)
      .accountsPartial({
        pool: pool1Pda,
        ammConfig: ammConfig1Pubkey,

        trader: yash.publicKey,

        sendMint: sendMint.publicKey,
        sendTokenVault: sendMintPool1Vault,
        traderSendToken: yashSendMintAta,
        sendTokenProgram: TOKEN_PROGRAM_ID,

        receiveMint: receiveMint.publicKey,
        receiveTokenVault: receiveMintPool1Vault,
        traderReceiveToken: yashReceiveMintAta,
        receiveTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();

    const {
      value: { amount: yashReceiveMint1TokenAmountAfterSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const sendAmount1 = swapAmount;
    const receiveAmount1 = new BN(yashReceiveMint1TokenAmountAfterSwap).sub(
      new BN(yashReceiveMint1TokenAmountBeforeSwap),
    );

    const executionPrice1 = new anchor.BN(receiveAmount1)
      .mul(new anchor.BN(1000))
      .div(new anchor.BN(sendAmount1));

    let priceImpact0 = spotPrice0.sub(executionPrice0);
    let priceImpact1 = spotPrice1.sub(executionPrice1);

    assert(priceImpact0.gt(priceImpact1)); // Price impact is inversely proportional to the reserves of the pool given the swap amount is same.
  });

  it("3", async () => {
    const {
      ammConfig: ammConfig0Pubkey,
      poolPda: pool0Pda,
      sendMintPoolVault: sendMintPool0Vault,
      receiveMintPoolVault: receiveMintPool0Vault,
    } = await setUpPool(1000000, 10000000);
    const {
      ammConfig: ammConfig1Pubkey,
      poolPda: pool1Pda,
      sendMintPoolVault: sendMintPool1Vault,
      receiveMintPoolVault: receiveMintPool1Vault,
    } = await setUpPool(2000000, 20000000);

    const {
      value: { amount: sendMintPool0Amount },
    } = await connection.getTokenAccountBalance(sendMintPool0Vault);

    const {
      value: { amount: receiveMintPool0Amount },
    } = await connection.getTokenAccountBalance(receiveMintPool0Vault);

    const spotPrice0 = new BN(receiveMintPool0Amount)
      .mul(new BN(1000))
      .div(new BN(sendMintPool0Amount));

    const {
      value: { amount: yashReceiveMint0TokenAmountBeforeSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const swapAmount0 = new BN(1000);
    await program.methods
      .swapBaseSend(swapAmount0, swapAmount0)
      .accountsPartial({
        pool: pool0Pda,
        ammConfig: ammConfig0Pubkey,

        trader: yash.publicKey,

        sendMint: sendMint.publicKey,
        sendTokenVault: sendMintPool0Vault,
        traderSendToken: yashSendMintAta,
        sendTokenProgram: TOKEN_PROGRAM_ID,

        receiveMint: receiveMint.publicKey,
        receiveTokenVault: receiveMintPool0Vault,
        traderReceiveToken: yashReceiveMintAta,
        receiveTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();
    const {
      value: { amount: yashReceiveMint0TokenAmountAfterSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const sendAmount0 = swapAmount0;
    const receiveAmount0 = new BN(yashReceiveMint0TokenAmountAfterSwap).sub(
      new BN(yashReceiveMint0TokenAmountBeforeSwap),
    );

    const executionPrice0 = new anchor.BN(receiveAmount0)
      .mul(new BN(1000))
      .div(new anchor.BN(sendAmount0));

    // -----
    const {
      value: { amount: yashReceiveMint1TokenAmountBeforeSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const {
      value: { amount: sendMintPool1Amount },
    } = await connection.getTokenAccountBalance(sendMintPool1Vault);
    const {
      value: { amount: receiveMintPool1Amount },
    } = await connection.getTokenAccountBalance(receiveMintPool1Vault);

    const spotPrice1 = new BN(receiveMintPool1Amount)
      .mul(new BN(1000))
      .div(new BN(sendMintPool1Amount));

    const swapAmount1 = new BN(2000);
    await program.methods
      .swapBaseSend(swapAmount1, swapAmount1)
      .accountsPartial({
        pool: pool1Pda,
        ammConfig: ammConfig1Pubkey,

        trader: yash.publicKey,

        sendMint: sendMint.publicKey,
        sendTokenVault: sendMintPool1Vault,
        traderSendToken: yashSendMintAta,
        sendTokenProgram: TOKEN_PROGRAM_ID,

        receiveMint: receiveMint.publicKey,
        receiveTokenVault: receiveMintPool1Vault,
        traderReceiveToken: yashReceiveMintAta,
        receiveTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([yash])
      .rpc();

    const {
      value: { amount: yashReceiveMint1TokenAmountAfterSwap },
    } = await connection.getTokenAccountBalance(yashReceiveMintAta);

    const sendAmount1 = swapAmount1;
    const receiveAmount1 = new BN(yashReceiveMint1TokenAmountAfterSwap).sub(
      new BN(yashReceiveMint1TokenAmountBeforeSwap),
    );

    const executionPrice1 = new anchor.BN(receiveAmount1)
      .mul(new anchor.BN(1000))
      .div(new anchor.BN(sendAmount1));

    let priceImpact0 = spotPrice0.sub(executionPrice0);
    let priceImpact1 = spotPrice1.sub(executionPrice1);

    assert(priceImpact0.eq(priceImpact1)); // Price impact in Receive token ∝ Amount of Send token swapped / Amount of Send tokens in the Pool given the fee rate is 0.
  });
});
