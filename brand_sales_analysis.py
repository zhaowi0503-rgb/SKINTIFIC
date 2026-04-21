#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
品牌销量分析工具 - 按品牌分别分析
1. 按渠道分析近14天趋势和近7天明细
2. 按国家分析波动情况
3. 识别异常SKU（Top 10 + 异常增长 + 异常下降）
"""

import gspread
from google.oauth2.service_account import Credentials
import pandas as pd
from datetime import datetime, timedelta
import warnings
import os
warnings.filterwarnings('ignore')

# Google Sheets配置
CREDENTIALS_FILE = os.getenv('GOOGLE_CREDENTIALS_FILE', '/Users/weizhao/Downloads/skintific-492616-339ab13aea8e.json')
SHEET_URL = 'https://docs.google.com/spreadsheets/d/1oqww7Wlojq0FwdjCOeKoKR2MLjJcd2IDTgZvpkF5wE8/edit?gid=1904689316#gid=1904689316'

def connect_and_load_data():
    """连接Google Sheet并加载数据"""
    print("正在连接Google Sheet...")
    scopes = [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive.readonly'
    ]

    creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scopes)
    client = gspread.authorize(creds)
    spreadsheet = client.open_by_url(SHEET_URL)
    worksheet = spreadsheet.get_worksheet(0)

    print(f"成功连接: {spreadsheet.title}\n")

    data = worksheet.get_all_records()
    df = pd.DataFrame(data)
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date')

    return df

def analyze_brand(df, brand_code, brand_name):
    """分析单个品牌"""
    print("\n" + "="*100)
    print(f"{'':^100}")
    print(f"{brand_name} 品牌销量分析报告".center(100, ' '))
    print(f"{'':^100}")
    print("="*100)

    # 筛选品牌数据
    df_brand = df[df['BRAND'] == brand_code].copy()

    if len(df_brand) == 0:
        print(f"\n⚠️  未找到 {brand_name} 品牌数据")
        return None

    latest_date = df_brand['Date'].max()
    date_14d_ago = latest_date - timedelta(days=13)
    date_7d_ago = latest_date - timedelta(days=6)

    print(f"\n📅 数据时间范围: {date_14d_ago.strftime('%Y-%m-%d')} 至 {latest_date.strftime('%Y-%m-%d')} (近14天)")

    df_14d = df_brand[df_brand['Date'] >= date_14d_ago].copy()
    df_7d = df_brand[df_brand['Date'] >= date_7d_ago].copy()

    # 1. 渠道维度分析
    analyze_channels(df_14d, df_7d, brand_name)

    # 2. 国家维度分析
    analyze_countries(df_14d, brand_name)

    # 3. SKU维度分析
    sku_analysis = analyze_skus(df_14d, df_7d, brand_name)

    return sku_analysis

def analyze_channels(df_14d, df_7d, brand_name):
    """渠道维度分析"""
    print("\n" + "┌" + "─"*98 + "┐")
    print(f"│ 📊 渠道维度分析{' '*82}│")
    print("└" + "─"*98 + "┘")

    # 按渠道和日期聚合
    channel_daily = df_14d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
    channels = sorted(channel_daily['Channels'].unique())

    # 近7天明细
    channel_7d = df_7d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
    channel_7d_pivot = channel_7d.pivot(index='Date', columns='Channels', values='UNIT').fillna(0)

    # 格式化日期显示
    channel_7d_pivot.index = channel_7d_pivot.index.strftime('%m-%d')

    print("\n📅 近7天各渠道日销量明细:")
    print("┌" + "─"*98 + "┐")

    # 创建表格
    header = "│ 日期    "
    for ch in channels:
        header += f"│ {ch:^12} "
    header += "│"
    print(header)
    print("├" + "─"*98 + "┤")

    for date, row in channel_7d_pivot.iterrows():
        line = f"│ {date:^7} "
        for ch in channels:
            val = row.get(ch, 0)
            line += f"│ {int(val):>12,} "
        line += "│"
        print(line)

    print("└" + "─"*98 + "┘")

    # 渠道分析结论
    print("\n📈 渠道增长分析:")
    print("┌" + "─"*98 + "┐")
    print("│ 渠道        │ 前7天日均  │ 后7天日均  │ 增长率    │ 趋势          │ 波动情况      │")
    print("├" + "─"*98 + "┤")

    for channel in channels:
        channel_data = channel_daily[channel_daily['Channels'] == channel].sort_values('Date')

        if len(channel_data) < 2:
            continue

        # 计算前7天和后7天平均值
        first_7d_avg = channel_data.head(7)['UNIT'].mean()
        last_7d_avg = channel_data.tail(7)['UNIT'].mean()
        growth_rate = ((last_7d_avg - first_7d_avg) / first_7d_avg * 100) if first_7d_avg > 0 else 0

        # 计算波动系数
        cv = channel_data['UNIT'].std() / channel_data['UNIT'].mean() if channel_data['UNIT'].mean() > 0 else 0

        # 趋势判断
        if growth_rate > 10:
            trend = "📈 显著增长"
        elif growth_rate > 0:
            trend = "↗️  小幅增长"
        elif growth_rate > -10:
            trend = "↘️  小幅下降"
        else:
            trend = "📉 显著下降"

        volatility = "✅ 稳定" if cv < 0.3 else "⚡ 波动较大" if cv < 0.6 else "⚠️  波动剧烈"

        print(f"│ {channel:^11} │ {first_7d_avg:>9,.0f}  │ {last_7d_avg:>9,.0f}  │ {growth_rate:>+7.1f}% │ {trend:^13} │ {volatility:^13} │")

    print("└" + "─"*98 + "┘")

def analyze_countries(df_14d, brand_name):
    """国家维度分析"""
    print("\n" + "┌" + "─"*98 + "┐")
    print(f"│ 🌍 国家维度分析{' '*82}│")
    print("└" + "─"*98 + "┘")

    # 按国家和日期聚合
    country_daily = df_14d.groupby(['Date', '地区'])['UNIT'].sum().reset_index()
    countries = country_daily['地区'].unique()

    country_stats = []

    for country in countries:
        country_data = country_daily[country_daily['地区'] == country].sort_values('Date')

        if len(country_data) < 14:
            continue

        # 计算前7天和后7天
        first_7d_avg = country_data.head(7)['UNIT'].mean()
        last_7d_avg = country_data.tail(7)['UNIT'].mean()
        growth_rate = ((last_7d_avg - first_7d_avg) / first_7d_avg * 100) if first_7d_avg > 0 else 0

        # 计算波动系数
        cv = country_data['UNIT'].std() / country_data['UNIT'].mean() if country_data['UNIT'].mean() > 0 else 0

        total_sales = country_data['UNIT'].sum()

        country_stats.append({
            '国家': country,
            '近14天总销量': total_sales,
            '前7天日均': first_7d_avg,
            '后7天日均': last_7d_avg,
            '增长率': growth_rate,
            '波动系数': cv
        })

    country_df = pd.DataFrame(country_stats)
    country_df = country_df.sort_values('近14天总销量', ascending=False)

    print("\n📊 国家销量排名及波动情况:")
    print("┌" + "─"*98 + "┐")
    print("│ 排名 │ 国家              │ 近14天总销量 │ 前7天日均 │ 后7天日均 │ 增长率    │ 波动情况      │")
    print("├" + "─"*98 + "┤")

    for idx, (_, row) in enumerate(country_df.head(10).iterrows(), 1):
        trend = "📈" if row['增长率'] > 10 else "↗️" if row['增长率'] > 0 else "↘️" if row['增长率'] > -10 else "📉"

        if row['波动系数'] > 0.6:
            volatility = "⚠️  波动剧烈"
        elif row['波动系数'] > 0.3:
            volatility = "⚡ 波动较大"
        else:
            volatility = "✅ 稳定"

        print(f"│ {idx:^4} │ {row['国家']:^17} │ {row['近14天总销量']:>11,.0f}  │ {row['前7天日均']:>8,.0f}  │ {row['后7天日均']:>8,.0f}  │ {row['增长率']:>+7.1f}% {trend} │ {volatility:^13} │")

    print("└" + "─"*98 + "┘")

def analyze_skus(df_14d, df_7d, brand_name):
    """SKU维度分析"""
    print("\n" + "┌" + "─"*98 + "┐")
    print(f"│ 🔍 SKU维度分析{' '*83}│")
    print("└" + "─"*98 + "┘")

    # 按SKU和日期聚合
    sku_daily = df_14d.groupby(['Date', 'SKU Code']).agg({
        'UNIT': 'sum',
        'SKU(ZH)': 'first',
        'SKU(EN)': 'first'
    }).reset_index()

    # 计算每个SKU的总销量
    sku_total = sku_daily.groupby('SKU Code').agg({
        'UNIT': 'sum',
        'SKU(ZH)': 'first',
        'SKU(EN)': 'first'
    }).reset_index()
    sku_total.columns = ['SKU Code', '近14天总销量', 'SKU(ZH)', 'SKU(EN)']

    # 获取Top 50 SKU进行分析
    top_skus_list = sku_total.nlargest(50, '近14天总销量')['SKU Code'].tolist()
    sku_daily_filtered = sku_daily[sku_daily['SKU Code'].isin(top_skus_list)]

    # 分析每个SKU
    sku_analysis = []

    for sku in top_skus_list:
        sku_data = sku_daily_filtered[sku_daily_filtered['SKU Code'] == sku].sort_values('Date')

        if len(sku_data) < 7:
            continue

        # 计算连续趋势
        sku_data = sku_data.copy()
        sku_data['daily_change'] = sku_data['UNIT'].diff()

        # 检测连续增长/下降
        consecutive_up = 0
        consecutive_down = 0
        max_consecutive_up = 0
        max_consecutive_down = 0

        for change in sku_data['daily_change'].dropna():
            if change > 0:
                consecutive_up += 1
                consecutive_down = 0
                max_consecutive_up = max(max_consecutive_up, consecutive_up)
            elif change < 0:
                consecutive_down += 1
                consecutive_up = 0
                max_consecutive_down = max(max_consecutive_down, consecutive_down)
            else:
                consecutive_up = 0
                consecutive_down = 0

        # 计算前7天和后7天对比
        if len(sku_data) >= 14:
            first_7d_avg = sku_data.head(7)['UNIT'].mean()
            last_7d_avg = sku_data.tail(7)['UNIT'].mean()
        else:
            first_7d_avg = sku_data.head(min(7, len(sku_data)))['UNIT'].mean()
            last_7d_avg = sku_data.tail(min(7, len(sku_data)))['UNIT'].mean()

        growth_rate = ((last_7d_avg - first_7d_avg) / first_7d_avg * 100) if first_7d_avg > 0 else 0

        # 分类
        category = "正常"
        if max_consecutive_up >= 4 or growth_rate > 100:
            category = "异常增长"
        elif max_consecutive_down >= 4 or growth_rate < -50:
            category = "异常下降"

        sku_info = sku_data.iloc[0]
        sku_analysis.append({
            'SKU Code': sku,
            'SKU(ZH)': sku_info['SKU(ZH)'],
            'SKU(EN)': sku_info['SKU(EN)'],
            '分类': category,
            '前7天日均': first_7d_avg,
            '后7天日均': last_7d_avg,
            '增长率': growth_rate,
            '连续增长天数': max_consecutive_up,
            '连续下降天数': max_consecutive_down,
            '近14天总销量': sku_data['UNIT'].sum()
        })

    analysis_df = pd.DataFrame(sku_analysis)

    # 1. Top 10 SKU销量波动（至少5个）
    print("\n📊 Top 10 SKU 销量波动:")
    print("┌" + "─"*98 + "┐")
    print("│ 排名 │ SKU Code         │ SKU名称                │ 近14天销量 │ 增长率    │ 变化趋势              │")
    print("├" + "─"*98 + "┤")

    top10 = analysis_df.nlargest(min(10, len(analysis_df)), '近14天总销量')

    for idx, (_, row) in enumerate(top10.iterrows(), 1):
        # 判断是增长还是下降
        if row['增长率'] > 0:
            change_desc = f"{int(row['前7天日均'])}→{int(row['后7天日均'])}件/天"
            if row['连续增长天数'] >= 2:
                change_desc += f" 连续{int(row['连续增长天数'])}天↑"
        else:
            change_desc = f"{int(row['前7天日均'])}→{int(row['后7天日均'])}件/天"
            if row['连续下降天数'] >= 2:
                change_desc += f" 连续{int(row['连续下降天数'])}天↓"

        trend = "📈" if row['增长率'] > 10 else "↗️" if row['增长率'] > 0 else "↘️" if row['增长率'] > -10 else "📉"

        sku_name = row['SKU(ZH)'][:10] if len(row['SKU(ZH)']) > 10 else row['SKU(ZH)']

        print(f"│ {idx:^4} │ {row['SKU Code']:^16} │ {sku_name:^22} │ {row['近14天总销量']:>9,.0f}  │ {row['增长率']:>+7.1f}% {trend} │ {change_desc:^21} │")

    print("└" + "─"*98 + "┘")

    # 2. 异常增长（至少5个）
    print("\n🚀 异常增长 SKU (Top 5):")
    print("┌" + "─"*98 + "┐")
    print("│ SKU Code         │ SKU名称                │ 增长率    │ 变化趋势              │ 近14天销量 │")
    print("├" + "─"*98 + "┤")

    growth_skus = analysis_df[analysis_df['分类'] == '异常增长'].nlargest(10, '增长率')

    # 如果异常增长不足5个，从正常增长中补充
    if len(growth_skus) < 5:
        normal_growth = analysis_df[
            (analysis_df['分类'] == '正常') &
            (analysis_df['增长率'] > 20)
        ].nlargest(10, '增长率')
        growth_skus = pd.concat([growth_skus, normal_growth]).drop_duplicates().nlargest(5, '增长率')

    if len(growth_skus) > 0:
        for _, row in growth_skus.head(5).iterrows():
            change_desc = f"{int(row['前7天日均'])}→{int(row['后7天日均'])}件/天"
            if row['连续增长天数'] >= 2:
                change_desc += f" 连续{int(row['连续增长天数'])}天↑"

            sku_name = row['SKU(ZH)'][:10] if len(row['SKU(ZH)']) > 10 else row['SKU(ZH)']

            print(f"│ {row['SKU Code']:^16} │ {sku_name:^22} │ {row['增长率']:>+7.1f}%  │ {change_desc:^21} │ {row['近14天总销量']:>9,.0f}  │")
    else:
        print("│ 未检测到显著增长SKU" + " "*75 + "│")

    print("└" + "─"*98 + "┘")

    # 3. 异常下降（至少5个）
    print("\n📉 异常下降 SKU (Top 5):")
    print("┌" + "─"*98 + "┐")
    print("│ SKU Code         │ SKU名称                │ 下降率    │ 变化趋势              │ 近14天销量 │")
    print("├" + "─"*98 + "┤")

    decline_skus = analysis_df[analysis_df['分类'] == '异常下降'].nsmallest(10, '增长率')

    # 如果异常下降不足5个，从正常下降中补充
    if len(decline_skus) < 5:
        normal_decline = analysis_df[
            (analysis_df['分类'] == '正常') &
            (analysis_df['增长率'] < -10)
        ].nsmallest(10, '增长率')
        decline_skus = pd.concat([decline_skus, normal_decline]).drop_duplicates().nsmallest(5, '增长率')

    if len(decline_skus) > 0:
        for _, row in decline_skus.head(5).iterrows():
            change_desc = f"{int(row['前7天日均'])}→{int(row['后7天日均'])}件/天"
            if row['连续下降天数'] >= 2:
                change_desc += f" 连续{int(row['连续下降天数'])}天↓"

            sku_name = row['SKU(ZH)'][:10] if len(row['SKU(ZH)']) > 10 else row['SKU(ZH)']

            print(f"│ {row['SKU Code']:^16} │ {sku_name:^22} │ {row['增长率']:>7.1f}%  │ {change_desc:^21} │ {row['近14天总销量']:>9,.0f}  │")
    else:
        print("│ 未检测到显著下降SKU" + " "*75 + "│")

    print("└" + "─"*98 + "┘")

    return analysis_df

def print_summary(skt_analysis, tp_analysis, df):
    """输出总结发现"""
    print("\n" + "="*100)
    print(f"{'':^100}")
    print("📋 核心发现总结".center(100, ' '))
    print(f"{'':^100}")
    print("="*100)

    # SKINTIFIC品牌总结
    if skt_analysis is not None and len(skt_analysis) > 0:
        print("\n" + "┌" + "─"*98 + "┐")
        print(f"│ 🔷 SKINTIFIC 品牌{' '*81}│")
        print("└" + "─"*98 + "┘")

        # 渠道增长
        latest_date = df['Date'].max()
        date_14d_ago = latest_date - timedelta(days=13)
        df_skt = df[df['BRAND'] == 'SKT']
        df_14d = df_skt[df_skt['Date'] >= date_14d_ago]

        channel_daily = df_14d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
        channels = sorted(channel_daily['Channels'].unique())

        print("\n  📈 渠道表现:")
        for channel in channels:
            channel_data = channel_daily[channel_daily['Channels'] == channel].sort_values('Date')
            if len(channel_data) >= 14:
                first_7d_avg = channel_data.head(7)['UNIT'].mean()
                last_7d_avg = channel_data.tail(7)['UNIT'].mean()
                growth_rate = ((last_7d_avg - first_7d_avg) / first_7d_avg * 100) if first_7d_avg > 0 else 0
                print(f"     • {channel}: {growth_rate:+.1f}% 增长")

        # 市场分布
        country_total = df_14d.groupby('地区')['UNIT'].sum().sort_values(ascending=False)
        top_country = country_total.index[0]
        top_country_sales = country_total.iloc[0]
        print(f"\n  🌍 主要市场: {top_country}（近14天总销量 {top_country_sales:,.0f} 件）")

        # Top SKU
        top_sku = skt_analysis.nlargest(1, '近14天总销量').iloc[0]
        print(f"\n  🏆 Top SKU: {top_sku['SKU(ZH)']}（{top_sku['SKU Code']}）")
        print(f"     近14天销量: {top_sku['近14天总销量']:,.0f} 件")

        # 异常增长
        growth_skus = skt_analysis[skt_analysis['分类'] == '异常增长'].nlargest(3, '增长率')
        if len(growth_skus) > 0:
            print(f"\n  🚀 异常增长 SKU:")
            for _, row in growth_skus.iterrows():
                print(f"     • {row['SKU(ZH)']}: {row['增长率']:+.1f}%")

        # 异常下降
        decline_skus = skt_analysis[skt_analysis['分类'] == '异常下降'].nsmallest(3, '增长率')
        if len(decline_skus) > 0:
            print(f"\n  📉 异常下降 SKU:")
            for _, row in decline_skus.iterrows():
                print(f"     • {row['SKU(ZH)']}: {row['增长率']:.1f}%")

    # Timephoria品牌总结
    if tp_analysis is not None and len(tp_analysis) > 0:
        print("\n" + "┌" + "─"*98 + "┐")
        print(f"│ 🔶 Timephoria 品牌{' '*80}│")
        print("└" + "─"*98 + "┘")

        # 渠道增长
        df_tp = df[df['BRAND'] == 'TP']
        df_14d = df_tp[df_tp['Date'] >= date_14d_ago]

        channel_daily = df_14d.groupby(['Date', 'Channels'])['UNIT'].sum().reset_index()
        channels = sorted(channel_daily['Channels'].unique())

        print("\n  📈 渠道表现:")
        for channel in channels:
            channel_data = channel_daily[channel_daily['Channels'] == channel].sort_values('Date')
            if len(channel_data) >= 14:
                first_7d_avg = channel_data.head(7)['UNIT'].mean()
                last_7d_avg = channel_data.tail(7)['UNIT'].mean()
                growth_rate = ((last_7d_avg - first_7d_avg) / first_7d_avg * 100) if first_7d_avg > 0 else 0
                print(f"     • {channel}: {growth_rate:+.1f}% 增长")

        # 市场分布
        country_total = df_14d.groupby('地区')['UNIT'].sum().sort_values(ascending=False)
        top_country = country_total.index[0]
        top_country_sales = country_total.iloc[0]
        print(f"\n  🌍 主要市场: {top_country}（近14天总销量 {top_country_sales:,.0f} 件）")

        # Top SKU
        top_sku = tp_analysis.nlargest(1, '近14天总销量').iloc[0]
        print(f"\n  🏆 Top SKU: {top_sku['SKU(ZH)']}（{top_sku['SKU Code']}）")
        print(f"     近14天销量: {top_sku['近14天总销量']:,.0f} 件")

        # 异常增长
        growth_skus = tp_analysis[tp_analysis['分类'] == '异常增长'].nlargest(3, '增长率')
        if len(growth_skus) > 0:
            print(f"\n  🚀 异常增长 SKU:")
            for _, row in growth_skus.iterrows():
                print(f"     • {row['SKU(ZH)']}: {row['增长率']:+.1f}%")

        # 异常下降
        decline_skus = tp_analysis[tp_analysis['分类'] == '异常下降'].nsmallest(3, '增长率')
        if len(decline_skus) > 0:
            print(f"\n  📉 异常下降 SKU:")
            for _, row in decline_skus.iterrows():
                print(f"     • {row['SKU(ZH)']}: {row['增长率']:.1f}%")

    print("\n" + "="*100)

if __name__ == '__main__':
    # 加载数据
    df = connect_and_load_data()

    # 分析SKINTIFIC品牌
    skt_analysis = analyze_brand(df, 'SKT', 'SKINTIFIC')

    # 分析Timephoria品牌
    tp_analysis = analyze_brand(df, 'TP', 'Timephoria')

    # 输出总结
    print_summary(skt_analysis, tp_analysis, df)

    print("\n" + "="*100)
    print("✅ 分析完成！")
    print("="*100)
