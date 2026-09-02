use anchor_lang::prelude::*;

use crate::{states::*,error::ErrorCode,constants::*};

#[derive(Accounts)]
pub struct UpdateAmmConfig<'info> {

    pub update_authority:Signer<'info>,

    #[account(
        mut,
        constraint = amm_config.update_authority == Some(update_authority.key()) @ ErrorCode::MismatchUpdateAuthority
    )]
    pub amm_config: Account<'info,AmmConfig>,
}

pub fn handle_update_amm_config(ctx:Context<UpdateAmmConfig>,config:AmmConfig) -> Result<()> {
    require!(config.swap_fee_rate_in_bps <= MAX_SWAP_FEES_BASIS_POINTS,ErrorCode::InvalidFees);

    let amm_config_acc = &mut ctx.accounts.amm_config;
    amm_config_acc.set_inner(config);
    Ok(())
}