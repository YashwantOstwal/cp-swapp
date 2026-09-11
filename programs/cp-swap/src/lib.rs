pub mod constants;
pub mod error;
pub mod instructions;
pub mod states;
pub mod math;
pub mod utils;

use anchor_lang::prelude::{*,pubkey};

pub use constants::*;
pub use instructions::*;
pub use states::*;
pub use utils::*;
pub use math::*;


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
    pub fn deposit(ctx: Context<Deposit>,min_amount_0_lp_receive:u64,min_amount_1_lp_receive:u64,dilute_lp_tokens:u64) -> Result<()> {
        instructions::handle_deposit(ctx, min_amount_0_lp_receive,min_amount_1_lp_receive,dilute_lp_tokens)
    }

    pub fn withdraw(ctx: Context<Withdraw>,max_amount_0_lp_send:u64,max_amount_1_lp_send:u64,req_lp_tokens:u64) -> Result<()> {
        instructions::handle_withdraw(ctx, max_amount_0_lp_send,max_amount_1_lp_send,req_lp_tokens)
    }
    pub fn swap_base_send(ctx: Context<SwapBaseSend>,exact_input_amount:u64,min_output_amount:u64) -> Result<()> {
        instructions::handle_swap_base_send(ctx,exact_input_amount,min_output_amount)
    }
    pub fn swap_base_receive(ctx: Context<SwapBaseReceive>,exact_input_amount:u64,min_output_amount:u64) -> Result<()> {
        instructions::handle_swap_base_receive(ctx,exact_input_amount,min_output_amount)
    }
}
