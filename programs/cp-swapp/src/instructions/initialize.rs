
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
     token::{
        Token
    },
     token_2022::spl_token_2022::{
        self,
        extension::{ 
            BaseStateWithExtensions, ExtensionType, StateWithExtensions, transfer_fee::{
                MAX_FEE_BASIS_POINTS, TransferFeeConfig
            }
        }
    },
     token_interface::{
        Mint, TokenAccount, TokenInterface,MintToChecked,mint_to_checked,TransferChecked,transfer_checked
    }
};

use crate::{LOCKED_LP, SWAP_FEES_DENOMINATION, constants::{POOL_AUTHORITY, POOL_LP_MINT}, error::ErrorCode};

#[derive(Accounts)]
#[instruction(fees_in_ppm:u32)]
pub struct Initialize<'info>{

    // Creator of the CPMM pool.
    #[account(mut)]
    pub creator:Signer<'info>,
    
    #[account(
        mut,
        mint::token_program = token_a_program,
        constraint = mint_a.key() < mint_b.key() @ErrorCode::MintAGreaterThanOrEqualMintB
    )]
    pub mint_a:Box<InterfaceAccount<'info,Mint>>,

    #[account(
        mut,
        mint::token_program = token_b_program,
        constraint = mint_a.key() < mint_b.key() @ErrorCode::MintAGreaterThanOrEqualMintB
    )]
    pub mint_b:Box<InterfaceAccount<'info,Mint>>,
    
    #[account(
        mut, 
        token::mint = mint_a,
        token::authority = creator,
        token::token_program = token_a_program
    )]
    pub creator_token_a:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mut, 
        token::mint = mint_a,
        token::authority = creator,
        token::token_program = token_a_program
    )]
    pub creator_token_b:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        seeds = [POOL_AUTHORITY.as_bytes(),mint_a.key().as_ref(),mint_b.key().as_ref(),fees_in_ppm.to_le_bytes().as_ref()],
        bump
    )]
    pub authority:SystemAccount<'info>,

    #[account(
        init,
        payer = creator,
        seeds = [POOL_LP_MINT.as_bytes(),mint_a.key().as_ref(),mint_b.key().as_ref(),fees_in_ppm.to_le_bytes().as_ref()],
        bump,
        mint::decimals = 9,
        mint::authority = authority,
        mint::token_program = token_program
    )]
    pub lp_mint:Box<InterfaceAccount<'info,Mint>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = lp_mint,
        associated_token::authority = creator,
        associated_token::token_program = token_program
    )]
    pub creator_lp_token:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint_a,
        associated_token::authority = authority,
        associated_token::token_program = token_a_program
    )]
    pub token_a_vault:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint_b,
        associated_token::authority = authority,
        associated_token::token_program = token_b_program
    )]
    pub token_b_vault:Box<InterfaceAccount<'info,TokenAccount>>,

    pub system_program:Program<'info,System>,
    pub token_program:Program<'info,Token>,
    pub token_a_program:Interface<'info,TokenInterface>,
    pub token_b_program:Interface<'info,TokenInterface>,
    pub associated_token_program:Program<'info,AssociatedToken>
}

pub fn initialize_handler(ctx:Context<Initialize>,fees_in_ppm:u32,net_init_amount_a:u64,net_init_amount_b:u64)->Result<()>{

    require_gt!(SWAP_FEES_DENOMINATION,fees_in_ppm,ErrorCode::InvalidFees);
    require!(is_supported_mint(&ctx.accounts.mint_a)? && is_supported_mint(&ctx.accounts.mint_b)?, ErrorCode::AtleastOneOfTheMintsNotSupported);
    let (transfer_fee_a,transfer_fee_b) = (get_inverse_transfer_fee(&ctx.accounts.mint_a, net_init_amount_a)?,get_inverse_transfer_fee(&ctx.accounts.mint_b, net_init_amount_b)?);

    let (gross_transfer_a,gross_transfer_b) = (net_init_amount_a + transfer_fee_a,net_init_amount_b + transfer_fee_b);
    require_gte!(gross_transfer_a,ctx.accounts.creator_token_a.amount,ErrorCode::InsufficientFunds);
    require_gte!(gross_transfer_b,ctx.accounts.creator_token_b.amount,ErrorCode::InsufficientFunds);

    let liquidity: u64 = u64::try_from(u128::from(net_init_amount_a).checked_mul(net_init_amount_b.into()).unwrap().isqrt())?;

    require_gt!(liquidity,LOCKED_LP as u64,ErrorCode::NotEnoughLiquidity);

    let mint_a_pubkey = ctx.accounts.mint_a.key();
    let mint_b_pubkey = ctx.accounts.mint_b.key();
    let fees_in_ppm_bytes = fees_in_ppm.to_le_bytes();

    let pool_authority_seeds:&[&[u8]] = &[
        POOL_AUTHORITY.as_bytes().as_ref(),
        mint_a_pubkey.as_ref(),
        mint_b_pubkey.as_ref(),
        fees_in_ppm_bytes.as_ref(),
        &[ctx.bumps.authority]
    ]; 

    let signer_seeds = &[&pool_authority_seeds[..]];
    let mint_ctx = CpiContext::new(ctx.accounts.token_program.key(),MintToChecked{
        mint:ctx.accounts.lp_mint.to_account_info(),
        to:ctx.accounts.creator_lp_token.to_account_info(),
        authority:ctx.accounts.authority.to_account_info()
    }).with_signer(signer_seeds);

    mint_to_checked(mint_ctx, liquidity.checked_sub(LOCKED_LP).unwrap(),ctx.accounts.lp_mint.decimals)?;

    let transfer_tokens_a_ctx = CpiContext::new(ctx.accounts.token_a_program.key(),TransferChecked{
        mint:ctx.accounts.mint_a.to_account_info(),
        from:ctx.accounts.creator_token_a.to_account_info(),
        to:ctx.accounts.token_a_vault.to_account_info(),
        authority:ctx.accounts.creator.to_account_info()
    });
    let transfer_tokens_b_ctx = CpiContext::new(ctx.accounts.token_b_program.key(),TransferChecked{
        mint:ctx.accounts.mint_b.to_account_info(),
        from:ctx.accounts.creator_token_b.to_account_info(),
        to:ctx.accounts.token_b_vault.to_account_info(),
        authority:ctx.accounts.authority.to_account_info()
    });

    transfer_checked(transfer_tokens_a_ctx, net_init_amount_a, ctx.accounts.mint_a.decimals)?;
    transfer_checked(transfer_tokens_b_ctx, net_init_amount_b, ctx.accounts.mint_b.decimals)?;
    Ok(())
}

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


pub fn is_supported_mint(mint:&InterfaceAccount<Mint>)->Result<bool>{
    let mint_info = mint.to_account_info();
    if *mint_info.owner == Token::id() {
        return Ok(true);
    }
    let mint_data = mint_info.try_borrow_data()?;
    let mint_state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
    let mint_extension_types = mint_state.get_extension_types()?;
    for extension in mint_extension_types {
        if extension != ExtensionType::TransferFeeConfig && extension != ExtensionType::MetadataPointer &&extension != ExtensionType::TokenMetadata && extension != ExtensionType::InterestBearingConfig && extension != ExtensionType::ScaledUiAmount{
          return Ok(false);
        }
    }
    Ok(true)
}