pub mod constants;
pub mod error;
pub mod instructions;
pub mod states;
pub mod utils;

use anchor_lang::prelude::{*,pubkey};

pub use constants::*;
pub use instructions::*;
pub use states::*;
pub use utils::*;

declare_id!("8FtgY3WxHTFMJP7AZKhBZHF1KiSDZ6SBbbxLK1wpAcBo");

// const ADMIN_PUBKEY:Pubkey = pubkey!();
#[program]
pub mod cp_swap {
    use super::*;

    pub fn create_amm_config(ctx: Context<CreateAmmConfig>,config:AmmConfig) -> Result<()> {
        instructions::handle_create_amm_config(ctx, config)
    }

    pub fn update_amm_config(ctx: Context<UpdateAmmConfig>,config:AmmConfig) -> Result<()> {
        instructions::handle_update_amm_config(ctx, config)
    }

    pub fn initialize(ctx: Context<Initialize>,init_amount_0:u64,init_amount_1:u64,transfer_checked_fee_0:u64,transfer_checked_fee_1:u64) -> Result<()> {
        instructions::handle_initialize(ctx, init_amount_0, init_amount_1,transfer_checked_fee_0,transfer_checked_fee_1)
    }
    pub fn deposit(ctx: Context<Deposit>,fees_in_ppm:u32,lp_tokens_required:u64,max_deposit_a:u64,max_deposit_b:u64) -> Result<()> {
        instructions::deposit_handler(ctx, fees_in_ppm,lp_tokens_required,max_deposit_a,max_deposit_b)
    }
    // pub fn swap_base_input(ctx: Context<SwapBaseInput>,fees_in_ppm:u32,exact_input_amount:u64,min_output_amount:u64) -> Result<()> {
    //     instructions::swap_base_input_handler(ctx, fees_in_ppm,exact_input_amount,min_output_amount)
    // }
}
