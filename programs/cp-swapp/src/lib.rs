pub mod constants;
pub mod error;
pub mod instructions;
pub mod states;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use states::*;

declare_id!("7SghMcfPqxKxVbrpMtEJ7rR24g2Cjbzm82C14wo3pqFy");

#[program]
pub mod cp_swapp {
    use super::*;

    // pub fn initialize(ctx: Context<Initialize>,fees_in_ppm:u32,net_init_amount_a:u64,net_init_amount_b:u64) -> Result<()> {
    //     instructions::initialize_handler(ctx, fees_in_ppm,net_init_amount_a, net_init_amount_b)
    // }
    pub fn deposit(ctx: Context<Deposit>,fees_in_ppm:u32) -> Result<()> {
        instructions::deposit_handler(ctx, fees_in_ppm)
    }
}
