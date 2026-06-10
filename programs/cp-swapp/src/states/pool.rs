use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Pool{
    pub mint_a:Pubkey,
    pub mint_b:Pubkey,
    pub fees_in_ppm:u32,
    pub bump:u8,
}