use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::MAX_FEE_BASIS_POINTS;
#[account]
#[derive(InitSpace,Debug)]
pub struct AmmConfig {
    pub disable_create_pool:bool,
    pub swap_fee_rate_in_bps:u16,
    pub update_authority:Option<Pubkey>,
    pub fee_side_input:bool,
}

impl AmmConfig {
    pub const LEN:usize = 8 + AmmConfig::INIT_SPACE;

    fn ceil_div(numerator:u64,denominator:u64) -> u64 {
        return numerator.checked_add(denominator).unwrap().checked_sub(1).unwrap().checked_div(denominator).unwrap()
    }

    pub fn calculate_fee(&self,pre_fee_amount:u64) -> u64 {
        let numerator = pre_fee_amount.checked_mul(self.swap_fee_rate_in_bps.into()).unwrap();
        return Self::ceil_div(numerator,MAX_FEE_BASIS_POINTS as u64)
    }

    pub fn calculate_post_fee_amount(&self,pre_fee_amount:u64) -> u64 {
        pre_fee_amount.checked_sub(Self::calculate_fee(&self, pre_fee_amount)).unwrap()
    }

    pub fn calculate_pre_fee_amount(&self,post_fee_amount:u64) -> u64 {
        let numerator = post_fee_amount.checked_mul(MAX_FEE_BASIS_POINTS as u64).unwrap();
        let denominator = (MAX_FEE_BASIS_POINTS as u64).checked_sub(self.swap_fee_rate_in_bps.into()).unwrap();
        Self::ceil_div(numerator, denominator)
    }

    pub fn calculate_inverse_fee(&self,post_fee_amount:u64) -> u64 {
        let pre_fee_amount = Self::calculate_pre_fee_amount(&self, post_fee_amount);
        pre_fee_amount.checked_sub(post_fee_amount).unwrap()
    }
}