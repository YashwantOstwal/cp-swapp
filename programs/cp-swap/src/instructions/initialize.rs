use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken,token::{Token},token_2022::{MintToChecked,mint_to_checked,Token2022}, token_interface::{transfer_checked_with_fee, TransferChecked,transfer_checked,Mint, TokenAccount, TokenInterface, TransferCheckedWithFee}};
use crate::{constants::*, error::ErrorCode, is_mint_supported, states::*};

#[derive(Accounts)]
pub struct Initialize<'info>{

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        constraint = !amm_config.disable_create_pool @ ErrorCode::AmmConfigDisabledForPoolCreation 
    )]
    pub amm_config: Box<Account<'info, AmmConfig>>,

    #[account(
        mint::token_program = token_program_0,
    )]
    pub mint_0: Box<InterfaceAccount<'info,Mint>>,
    pub token_program_0: Interface<'info,TokenInterface>,

    #[account(
        mint::token_program = token_program_1,
        constraint = mint_0.key() < mint_1.key() @ ErrorCode::Mint1LexicographicallyGreaterThanOrEqualToMint0
    )]
    pub mint_1: Box<InterfaceAccount<'info,Mint>>,
    pub token_program_1: Interface<'info,TokenInterface>,

    #[account(
        mut,
        token::mint = mint_0,
        token::authority = creator,
        token::token_program = token_program_0
    )]
    pub creator_0_token:Box<InterfaceAccount<'info,TokenAccount>>,


    #[account(
        mut,
        token::mint = mint_1,
        token::authority = creator,
        token::token_program = token_program_1
    )]
    pub creator_1_token:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        init,
        payer = creator,
        space = Pool::LEN,
        seeds = [Pool::STATIC_SEED,amm_config.key().as_ref(),mint_0.key().as_ref(),mint_1.key().as_ref()],
        bump
    )]
    pub pool: Box<Account<'info,Pool>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint_0,
        associated_token::authority = pool,
        associated_token::token_program = token_program_0,
    )]
    pub token_0_vault: Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint_1,
        associated_token::authority = pool,
        associated_token::token_program = token_program_1,
    )]
    pub token_1_vault: Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        init,
        payer = creator,
        mint::decimals = 0,
        mint::authority = pool,
        mint::token_program = token_2022_program,
        seeds = [LP_MINT_STATIC_SEED,pool.key().as_ref()],
        bump,
    )]
    pub lp_mint: Box<InterfaceAccount<'info,Mint>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = lp_mint,
        associated_token::authority = creator,
        associated_token::token_program = token_2022_program,
    )]
    pub creator_lp_ata: Box<InterfaceAccount<'info,TokenAccount>>,

    pub system_program:Program<'info,System>,
    pub token_2022_program: Program<'info,Token2022>,
    pub associated_token_program:Program<'info,AssociatedToken>,
}
pub fn handle_initialize(ctx:Context<Initialize>,init_amount_0:u64,init_amount_1:u64,transfer_checked_fee_0:u64,transfer_checked_fee_1:u64) -> Result<()> {
    
    is_mint_supported(&ctx.accounts.mint_0)?;
    is_mint_supported(&ctx.accounts.mint_1)?; 

    let gross_amount_0 = init_amount_0.checked_add(transfer_checked_fee_0).unwrap();
    let gross_amount_1 = init_amount_1.checked_add(transfer_checked_fee_1).unwrap();

    require!(gross_amount_0 <= ctx.accounts.creator_0_token.amount,ErrorCode::InsufficientFunds);
    require!(gross_amount_1 <= ctx.accounts.creator_1_token.amount,ErrorCode::InsufficientFunds);

    if ctx.accounts.token_program_0.key() == Token::id() {
        let transfer_0_ctx = CpiContext::new(ctx.accounts.token_program_0.key(),TransferChecked {
            from:ctx.accounts.creator_0_token.to_account_info(),
            to:ctx.accounts.token_0_vault.to_account_info(),
            mint:ctx.accounts.mint_0.to_account_info(),
            authority:ctx.accounts.creator.to_account_info()
        });
        transfer_checked(transfer_0_ctx, gross_amount_0, ctx.accounts.mint_0.decimals)?;
    }else {
        let transfer_0_ctx = CpiContext::new(ctx.accounts.token_program_0.key(),TransferCheckedWithFee {
            token_program_id:ctx.accounts.token_program_0.to_account_info(),
            source:ctx.accounts.creator_0_token.to_account_info(),
            destination:ctx.accounts.token_0_vault.to_account_info(),
            mint:ctx.accounts.mint_0.to_account_info(),
            authority:ctx.accounts.creator.to_account_info()
        });
        transfer_checked_with_fee(transfer_0_ctx, gross_amount_0, ctx.accounts.mint_0.decimals, transfer_checked_fee_0)?;
    }
    
    if ctx.accounts.token_program_1.key() == Token::id() {
        let transfer_1_ctx = CpiContext::new(ctx.accounts.token_program_1.key(),TransferChecked {
            from:ctx.accounts.creator_1_token.to_account_info(),
            to:ctx.accounts.token_1_vault.to_account_info(),
            mint:ctx.accounts.mint_1.to_account_info(),
            authority:ctx.accounts.creator.to_account_info()
        });
        transfer_checked(transfer_1_ctx, gross_amount_1, ctx.accounts.mint_1.decimals)?;
    }else {
        let transfer_1_ctx = CpiContext::new(ctx.accounts.token_program_1.key(),TransferCheckedWithFee {
            token_program_id:ctx.accounts.token_program_1.to_account_info(),
            source:ctx.accounts.creator_1_token.to_account_info(),
            destination:ctx.accounts.token_1_vault.to_account_info(),
            mint:ctx.accounts.mint_1.to_account_info(),
            authority:ctx.accounts.creator.to_account_info()
        });
        transfer_checked_with_fee(transfer_1_ctx, gross_amount_1, ctx.accounts.mint_1.decimals, transfer_checked_fee_1)?;
    }
    
    let liquidity = u64::try_from(((u128::from(init_amount_0)).checked_mul(init_amount_1.into()).unwrap()).isqrt()).unwrap();
    require!(liquidity >= MINIMUM_LIQUIDITY,ErrorCode::InsufficientLiquidity);

    let mint_lp_amount = liquidity - 100;

    let amm_config_key = ctx.accounts.amm_config.key();
    let mint_0_key = ctx.accounts.mint_0.key();
    let mint_1_key = ctx.accounts.mint_1.key();
    let pool_bump = ctx.bumps.pool;

    if mint_lp_amount > 0 {

        let pool_seeds:&[&[u8]] = &[Pool::STATIC_SEED,amm_config_key.as_ref(),mint_0_key.as_ref(),mint_1_key.as_ref(),&[pool_bump]];
        let signer_seeds = [&pool_seeds[..]];

        let mint_lp_ctx = CpiContext::new(ctx.accounts.token_2022_program.key(), MintToChecked {
            mint:ctx.accounts.lp_mint.to_account_info(),
            to:ctx.accounts.creator_lp_ata.to_account_info(),
            authority:ctx.accounts.pool.to_account_info()
        }).with_signer(&signer_seeds);

        mint_to_checked(mint_lp_ctx, mint_lp_amount, ctx.accounts.lp_mint.decimals)?;
    }
    let pool = &mut ctx.accounts.pool;
    pool.set_inner(Pool {
        creator: ctx.accounts.creator.key(),
        mint_0: mint_0_key,
        mint_1: mint_1_key,
        amm_config: amm_config_key,
        lp_supply: liquidity,
        bump: pool_bump,
        lp_mint_bump:ctx.bumps.lp_mint
    });
    Ok(())
}