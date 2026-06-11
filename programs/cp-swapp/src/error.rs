use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("MintAGreaterThanOrEqualMintB")]
    MintAGreaterThanOrEqualMintB,

    #[msg("AtleastOneOfTheMintsNotSupported")]
    AtleastOneOfTheMintsNotSupported,

    #[msg("ZeroTradingTokens")]
    ZeroTradingTokens,

    #[msg("MismatchInTransferFeeCalculation")]
    MismatchInTransferFeeCalculation,

    
    #[msg("InsufficientFunds")]
    InsufficientFunds,

    #[msg("NotEnoughLiquidity")]
    NotEnoughLiquidity,

    #[msg("InvalidPool")]
    InvalidPool,

    #[msg("InvalidInputAmount")]
    InvalidInputAmount,


    #[msg("InvalidFees")]
    InvalidFees,

    #[msg("MathOverflow")]
    MathOverflow,

    #[msg("FailedToExceedMinimum")]
    FailedToExceedMinimum
}
