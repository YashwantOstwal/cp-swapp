
use anchor_lang::prelude::*;
use anchor_spl::{
     token::Token,
     token_2022::spl_token_2022::{
        self,
        extension::{ 
            transfer_fee::{
                TransferFeeConfig, MAX_FEE_BASIS_POINTS
            }, BaseStateWithExtensions, Extension, ExtensionType, StateWithExtensions
        },
        state::Mint as MintState
    },
     token_interface::Mint
};
use crate::error::ErrorCode;

pub fn is_mint_supported(mint:&InterfaceAccount<Mint>) -> Result<()> {
    let mint_info = mint.to_account_info();
    if *mint_info.owner == Token::id() {
       return Ok(());
    }
    let mint_data = mint_info.try_borrow_data()?;
    let mint_state = StateWithExtensions::<MintState>::unpack(&mint_data)?;

    let mint_extensions = mint_state.get_extension_types()?;
    for mint_extension in mint_extensions.iter() {
        if mint_extension != &ExtensionType::TransferFeeConfig &&
            mint_extension != &ExtensionType::MetadataPointer && 
            mint_extension != &ExtensionType::TokenMetadata && 
            mint_extension != &ExtensionType::ScaledUiAmount && 
            mint_extension != &ExtensionType::InterestBearingConfig {
            return Err(anchor_lang::error!(ErrorCode::MintNotSupported));
        }
    }
    Ok(())

}
