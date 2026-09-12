use anchor_lang::prelude::*;
// use crate::constants::{SWAP_FEES_DENOMINATION};
#[account]
#[derive(InitSpace)]
pub struct Pool{
    pub creator:Pubkey,
    pub mint_0:Pubkey,
    pub mint_1:Pubkey,
    pub amm_config:Pubkey,
    pub lp_supply:u64,
    pub bump:u8,
    pub lp_mint_bump:u8,
}

impl Pool {
    pub const LEN:usize = 8 + Pool::INIT_SPACE;
    pub const STATIC_SEED:&[u8] = b"pool";

}