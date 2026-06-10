use anchor_lang::prelude::*;

use anchor_spl::{token_interface::{Mint}};
use crate::*;
#[derive(Accounts)]
#[instruction(fees_in_ppm:u32)]
pub struct Deposit<'info>{
    
    #[account(mut)]
    pub lp: Signer<'info>,

    pub mint_a:InterfaceAccount<'info,Mint>,
    pub mint_b:InterfaceAccount<'info,Mint>,

    
    #[account(
        has_one = mint_a,
        has_one = mint_b,

    )]
    pub pool_state:Account<'info,Pool>

}

pub fn deposit_handler(ctx:Context<Deposit>,fees_in_ppm:u32)->Result<()>{
    Ok(())
}
