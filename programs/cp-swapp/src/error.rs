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
    NotEnoughLiquidity
}
