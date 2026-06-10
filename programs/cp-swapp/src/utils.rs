
use anchor_lang::prelude::*;
use anchor_spl::{
     token::{
        Token
    },
     token_2022::spl_token_2022::{
        self,
        extension::{ 
            BaseStateWithExtensions, StateWithExtensions, transfer_fee::{
                MAX_FEE_BASIS_POINTS, TransferFeeConfig
            }
        }
    },
     token_interface::{
        Mint
    }
};
use crate::error::ErrorCode;
pub fn get_inverse_transfer_fee(mint:&InterfaceAccount<Mint>,post_fees_amount:u64)->Result<u64>{
    let mint_info = mint.to_account_info();
    if *mint_info.owner == Token::id(){
        return Ok(0);
    }
    require_gt!(post_fees_amount, 0,ErrorCode::ZeroTradingTokens);
    let mint_data = mint_info.try_borrow_data()?;
    let mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
    if let Ok(transfer_fee_config) = mint_state.get_extension::<TransferFeeConfig>(){
        let epoch = Clock::get()?.epoch;
        let transfer_fee = transfer_fee_config.get_epoch_fee(epoch);
        if u16::from(transfer_fee.transfer_fee_basis_points) == MAX_FEE_BASIS_POINTS {
            return Ok(u64::from(transfer_fee.maximum_fee));
        }else {
            let transfer_fee = transfer_fee_config.calculate_inverse_epoch_fee(epoch, post_fees_amount).unwrap();
            let transfer_fee_check = transfer_fee_config.calculate_epoch_fee(epoch, post_fees_amount.checked_add(transfer_fee).unwrap()).unwrap();

            if transfer_fee != transfer_fee_check {
                return err!(ErrorCode::MismatchInTransferFeeCalculation);
            }
            return Ok(transfer_fee)
        }
    }else {
        return Ok(0);
    }

}

