use anchor_lang::prelude::*;
use anchor_spl::{token_2022::{spl_token_2022::extension::transfer_fee::MAX_FEE_BASIS_POINTS}};
use crate::{states::*,error::ErrorCode,constants::*};

#[derive(Accounts)]
pub struct CreateAmmConfig<'info> {

    #[account(mut)]
    pub creator:Signer<'info>,

    #[account(
        init,
        space = AmmConfig::LEN,
        payer = creator,
    )]
    pub amm_config: Account<'info,AmmConfig>,
    pub system_program:Program<'info,System>
}

pub fn handle_create_amm_config(ctx:Context<CreateAmmConfig>,config:AmmConfig) -> Result<()> {
    require!(config.swap_fee_rate_in_bps < MAX_FEE_BASIS_POINTS,ErrorCode::InvalidFees);

    let amm_config_acc = &mut ctx.accounts.amm_config;
    amm_config_acc.set_inner(config);
    Ok(())
}