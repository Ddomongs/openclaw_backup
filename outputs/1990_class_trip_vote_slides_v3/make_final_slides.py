from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import textwrap, re, math

BASE=Path('outputs/1990_class_trip_vote_slides_v3')
BG=BASE/'backgrounds'
OUT=BASE/'final_png'
OUT.mkdir(parents=True,exist_ok=True)
W,H=2048,1152
FONT='/System/Library/Fonts/AppleSDGothicNeo.ttc'
def font(size): return ImageFont.truetype(FONT,size)
F={
 'title':font(74),'h1':font(58),'h2':font(42),'h3':font(34),'body':font(29),'small':font(24),'tiny':font(20),'num':font(48)
}
COL={'navy':'#14213D','blue':'#2D6CDF','mint':'#2BBF8A','orange':'#FF9F1C','red':'#E94F37','purple':'#7C3AED','gray':'#607086','dark':'#111827','white':'#FFFFFF','light':'#F8FAFC','line':'#DDE6F1'}

def bg_for(n):
    p=sorted(BG.glob(f'v3_bg_{n:02d}_*.png'))[0]
    im=Image.open(p).convert('RGB').resize((W,H))
    # soften for readability
    overlay=Image.new('RGBA',(W,H),(255,255,255,90))
    im=Image.alpha_composite(im.convert('RGBA'),overlay)
    return im

def draw_round(d,box,r=26,fill=(255,255,255,232),outline='#DDE6F1',width=2):
    d.rounded_rectangle(box,radius=r,fill=fill,outline=outline,width=width)

def shadow_card(im,box,r=28,fill=(255,255,255,238),outline='#DDE6F1'):
    layer=Image.new('RGBA',im.size,(0,0,0,0)); ld=ImageDraw.Draw(layer)
    x0,y0,x1,y1=box
    ld.rounded_rectangle((x0+8,y0+10,x1+8,y1+10),radius=r,fill=(15,23,42,35))
    layer=layer.filter(ImageFilter.GaussianBlur(8)); im.alpha_composite(layer)
    d=ImageDraw.Draw(im); draw_round(d,box,r,fill,outline)
    return d

def title(d,idx,t,sub=None):
    d.rounded_rectangle((70,48,170,98),radius=20,fill=COL['navy'])
    d.text((96,58),f'{idx:02d}',font=F['small'],fill='white')
    d.text((190,45),t,font=F['h1'],fill=COL['navy'])
    if sub: d.text((194,112),sub,font=F['small'],fill=COL['gray'])

def wrap(s,chars):
    res=[]
    for part in str(s).split('\n'):
        if not part: res.append(''); continue
        cur=''
        for ch in part:
            if len(cur)>=chars:
                res.append(cur); cur=ch
            else: cur+=ch
        if cur: res.append(cur)
    return res

def bullets(d,x,y,items,size='body',color=COL['dark'],bullet=COL['blue'],gap=42,chars=32):
    f=F[size]
    for it in items:
        d.ellipse((x,y+10,x+12,y+22),fill=bullet)
        lines=wrap(it,chars)
        for j,l in enumerate(lines):
            d.text((x+28,y+j*(f.size+4)),l,font=f,fill=color)
        y += gap + (len(lines)-1)*(f.size+4)
    return y

def pill(d,x,y,text,fill=COL['blue'],fg='white'):
    bbox=d.textbbox((0,0),text,font=F['small']); w=bbox[2]+42
    d.rounded_rectangle((x,y,x+w,y+46),radius=20,fill=fill)
    d.text((x+21,y+10),text,font=F['small'],fill=fg)
    return x+w+12

def table(d,x,y,w,row_h,headers,rows,col_ws,header_fill=COL['navy']):
    d.rounded_rectangle((x,y,x+w,y+row_h*(len(rows)+1)),radius=18,fill=(255,255,255,238),outline=COL['line'],width=2)
    d.rounded_rectangle((x,y,x+w,y+row_h),radius=18,fill=header_fill)
    cx=x
    for i,h in enumerate(headers):
        d.text((cx+16,y+13),h,font=F['small'],fill='white')
        cx+=col_ws[i]
        if i<len(headers)-1: d.line((cx,y,cx,y+row_h*(len(rows)+1)),fill=COL['line'],width=1)
    for r,row in enumerate(rows):
        yy=y+row_h*(r+1)
        d.line((x,yy,x+w,yy),fill=COL['line'],width=1)
        cx=x
        for i,cell in enumerate(row):
            f=F['tiny'] if len(str(cell))>18 else F['small']
            lines=wrap(cell,18 if col_ws[i]<250 else 28)
            for j,l in enumerate(lines[:2]):
                d.text((cx+14,yy+10+j*24),l,font=f,fill=COL['dark'])
            cx+=col_ws[i]

def save(im,n,name):
    p=OUT/f'{n:02d}_{name}.png'; im.convert('RGB').save(p,quality=95); return p

paths=[]
# 1 Cover
im=bg_for(1); d=ImageDraw.Draw(im)
shadow_card(im,(70,120,1020,930),36,(255,255,255,230)); d=ImageDraw.Draw(im)
d.text((130,185),'90년생 동창 12명',font=F['title'],fill=COL['navy'])
d.text((135,285),'1박2일 국내여행 후보 보고',font=F['h1'],fill=COL['dark'])
d.text((138,360),'투표로 결정하기 위한 거리·일정·예산 비교자료',font=F['h3'],fill=COL['gray'])
x=135
for txt,c in [('부산 출발 중심',COL['blue']),('인당 약 15만원',COL['orange']),('활동적인 여행',COL['mint'])]: x=pill(d,x,455,txt,c)
bullets(d,145,560,['목표: 12명이 이해하기 쉬운 투표 자료','기준: 이동시간, 액티비티, 예산, 숙소/회식','결론: 현실성 높은 후보를 먼저 압축'],size='h3',gap=62,chars=26)
paths.append(save(im,1,'cover'))
# 2 TOC
im=bg_for(2); d=ImageDraw.Draw(im); title(d,2,'목차','보고 → 비교 → 후보별 일정 → 투표 순서')
items=['여행 개요','투표 기준','후보지 전체 비교','부산 기준 이동거리·시간','예산 15만원 사용 기준','후보별 일정표·액티비티 가격','종합 추천 순위','최종 투표 방식']
for i,it in enumerate(items):
    col=i%2; row=i//2; x=120+col*900; y=230+row*190
    shadow_card(im,(x,y,x+800,y+132),24,(255,255,255,238)); d=ImageDraw.Draw(im)
    d.ellipse((x+28,y+32,x+88,y+92),fill=COL['blue'] if i<4 else COL['orange'])
    d.text((x+48,y+43),str(i+1),font=F['small'],fill='white')
    d.text((x+115,y+42),it,font=F['h3'],fill=COL['dark'])
paths.append(save(im,2,'toc'))
# 3 Conditions
im=bg_for(3); d=ImageDraw.Draw(im); title(d,3,'여행 조건','이번 자료의 전제 조건')
shadow_card(im,(80,230,1960,930),32,(255,255,255,235)); d=ImageDraw.Draw(im)
conds=[('인원','90년생 고등학교 동창 12명'),('기간','1박2일'),('예산','1인 약 15만원'),('출발','부산 중심 + 일부 타지역 합류'),('성향','매년 활동적인 국내여행 선호')]
for i,(k,v) in enumerate(conds):
    x=145+(i%2)*850; y=300+(i//2)*170
    d.rounded_rectangle((x,y,x+720,y+105),radius=24,fill='#F8FAFC',outline=COL['line'])
    d.text((x+30,y+24),k,font=F['h3'],fill=COL['blue'])
    d.text((x+190,y+25),v,font=F['h3'] if len(v)<18 else F['small'],fill=COL['dark'])
d.rounded_rectangle((145,820,1840,890),radius=22,fill='#FFF3DB',outline='#FFD166')
d.text((175,839),'발표 멘트: 예쁜 여행 소개가 아니라, 실제로 갈 수 있는지와 12명이 만족할지를 기준으로 비교했습니다.',font=F['small'],fill='#7A4A00')
paths.append(save(im,3,'conditions'))
# 4 Criteria
im=bg_for(4); d=ImageDraw.Draw(im); title(d,4,'투표 기준','이 기준으로 후보를 비교합니다')
criteria=[('이동 편의성','부산 기준 편도 시간 / 왕복 피로도'),('액티비티 재미','12명이 함께 즐길 수 있는 활동성'),('예산 적합성','1인 15만원 안에서 가능한지'),('숙소·회식 동선','단체 숙소, 저녁, 2차 동선'),('특별함','작년과 다른 추억이 남는지')]
for i,(k,v) in enumerate(criteria):
    x=110+(i%3)*630; y=250+(i//3)*260
    shadow_card(im,(x,y,x+560,y+185),28,(255,255,255,238)); d=ImageDraw.Draw(im)
    d.ellipse((x+28,y+32,x+88,y+92),fill=[COL['blue'],COL['mint'],COL['orange'],COL['purple'],COL['red']][i])
    d.text((x+49,y+43),str(i+1),font=F['small'],fill='white')
    d.text((x+112,y+38),k,font=F['h3'],fill=COL['dark'])
    d.text((x+112,y+92),v,font=F['small'],fill=COL['gray'])
d.rounded_rectangle((120,850,1880,920),radius=22,fill='#E8F1FF',outline='#BBD2FF')
d.text((150,869),'핵심: 부산 출발 인원이 많기 때문에 왕복 이동시간이 실제 만족도를 크게 좌우합니다.',font=F['small'],fill=COL['navy'])
paths.append(save(im,4,'criteria'))
# 5 Distance
im=bg_for(5); d=ImageDraw.Draw(im); title(d,5,'부산 기준 이동거리·시간','1박2일은 편도 2시간 이내가 가장 안정적')
rows=[('경주','약 85km','약 1시간 10분','1시간20분~1시간40분','안정권'),('거제·통영','약 91km','약 1시간 26분','1시간30분~2시간','안정권'),('여수','약 177km','약 2시간 31분','2시간50분~3시간30분','감수 가능'),('단양·제천','약 271~296km','약 3시간 31~44분','4시간 전후','부담권'),('강릉·양양','약 348~395km','약 5시간 6~37분','5시간30분~7시간','비효율')]
table(d,80,245,1880,88,['후보','거리','라우팅 시간','현실 체감','판단'],rows,[260,260,330,430,220])
d.rounded_rectangle((90,860,1840,935),radius=22,fill='#FFF3DB',outline='#FFD166')
d.text((125,882),'결론: 경주·거제/통영은 이동 안정권, 여수는 감수 가능, 단양/강릉권은 1박2일 효율이 떨어집니다.',font=F['small'],fill='#7A4A00')
paths.append(save(im,5,'distance'))
# 6 Budget
im=bg_for(6); d=ImageDraw.Draw(im); title(d,6,'예산 15만원 사용 기준','액티비티가 비싸면 숙소·식비 조절 필요')
budget=[('숙소','5만~7만원','단체 펜션/호텔'),('식사·술','5만~6만원','저녁 회식+장보기'),('액티비티','2만~4만원','카트/루지 기준'),('교통·기타','1만~2만원','유류비/주차/간식')]
for i,(a,b,c) in enumerate(budget):
    x=120+i*470; y=275
    shadow_card(im,(x,y,x+400,y+230),30,(255,255,255,240)); d=ImageDraw.Draw(im)
    d.text((x+32,y+35),a,font=F['h3'],fill=COL['dark'])
    d.text((x+32,y+95),b,font=F['h2'],fill=[COL['blue'],COL['orange'],COL['purple'],COL['mint']][i])
    d.text((x+32,y+165),c,font=F['small'],fill=COL['gray'])
rows=[('경주','매우 안정','루지/카트 포함 가능'),('거제·통영','안정','카트 1회 기준 적합'),('여수','조절 필요','숙소·식비 관리'),('단양·제천','빡빡','패러글라이딩 시 초과'),('강릉·양양','초과 가능','장거리+서핑 부담')]
table(d,150,620,1700,72,['후보','예산 판단','주의점'],rows,[360,360,980])
paths.append(save(im,6,'budget'))

def candidate_slide(n,name,subtitle,move,activity,price,schedule,pros,cons,conclusion,color):
    im=bg_for(n); d=ImageDraw.Draw(im); title(d,n,name,subtitle)
    # top pills
    x=100; y=170
    for txt,c in [(move,COL['blue']),(activity,color),(price,COL['orange'])]: x=pill(d,x,y,txt,c)
    shadow_card(im,(80,245,980,1005),30,(255,255,255,240)); d=ImageDraw.Draw(im)
    d.text((120,285),'1박2일 일정표',font=F['h2'],fill=COL['navy'])
    yy=355
    for t,desc in schedule:
        d.rounded_rectangle((120,yy,220,yy+48),radius=15,fill=COL['navy'])
        d.text((138,yy+11),t,font=F['tiny'],fill='white')
        lines=wrap(desc,30)
        for j,l in enumerate(lines[:2]): d.text((245,yy+6+j*26),l,font=F['small'],fill=COL['dark'])
        yy+=72
    shadow_card(im,(1040,245,1960,1005),30,(255,255,255,240)); d=ImageDraw.Draw(im)
    d.text((1085,285),'장점',font=F['h2'],fill=COL['navy']); bullets(d,1095,355,pros,size='small',bullet=color,gap=46,chars=32)
    d.text((1085,585),'주의점',font=F['h2'],fill=COL['navy']); bullets(d,1095,655,cons,size='small',bullet=COL['red'],gap=46,chars=32)
    d.rounded_rectangle((1085,850,1910,945),radius=24,fill=color)
    d.text((1120,879),'결론: '+conclusion,font=F['h3'],fill='white')
    return im

paths.append(save(candidate_slide(7,'경주','예산·이동 밸런스 1위','부산 약 85km / 체감 1.5시간','루지·보문·황리단길','액티비티 2만~4만원대 확인 필요',
[('10:00','부산 출발'),('11:30','경주 도착·점심'),('13:00','루지/카트 1.5~2시간'),('15:30','보문단지 카페·산책'),('17:00','숙소 체크인'),('18:30','저녁 회식·숙소 2차'),('2일차','브런치·황리단길 후 복귀')],
['15만원 예산 안에서 가장 안정적','비 와도 대체 일정 만들기 쉬움','숙소·식당·카페 선택지 넓음'],['새로움은 약할 수 있음','액티비티 강도는 단양보다 낮음'],'가장 무난하고 실패 확률 낮음',COL['mint']),7,'gyeongju'))
paths.append(save(candidate_slide(8,'거제·통영','바다 + 카트/루지 현실픽','부산 약 91km / 체감 1.5~2시간','더카트인·통영 루지','카트 1회 25,000원 / 2회 45,000원',
[('10:00','부산 출발'),('11:30','통영/거제 도착·점심'),('13:30','카트/루지 1.5~2시간'),('16:00','바다뷰 카페·해안 드라이브'),('17:30','숙소 체크인'),('19:00','바비큐/해산물 회식'),('2일차','해장·시장/바다 산책 후 복귀')],
['부산팀 이동 부담 낮음','카트라이더 느낌으로 재미 포인트 확실','바다+액티비티+단체숙소 조합 좋음'],['날씨 영향 있음','2회 이상 탑승 시 예산 조절 필요'],'가장 재밌는 현실픽',COL['blue']),8,'geoje_tongyeong'))
paths.append(save(candidate_slide(9,'여수','낭만 + 맛집 만족도 후보','부산 약 177km / 체감 3시간 전후','케이블카·유월드·낭만포차','1만~6만원대 확인 필요',
[('09:00','부산 출발'),('12:00','여수 도착·점심'),('13:30','케이블카/유월드 1.5~3시간'),('16:30','오동도·바다뷰 카페'),('18:00','숙소 체크인'),('19:30','낭만포차/해산물 회식'),('2일차','해장·카페/시장 후 복귀')],
['여행 온 느낌과 야경이 강함','맛집·술자리 만족도 높음','사진 남기기 좋음'],['숙소비와 식비 조절 필요','출발 시간을 앞당겨야 여유 있음'],'분위기는 좋지만 예산 관리 필요',COL['orange']),9,'yeosu'))
paths.append(save(candidate_slide(10,'단양·제천','액티비티 몰빵 후보','부산 약 271~296km / 체감 4시간','패러글라이딩·카트·수상레저','패러글라이딩 9만~13만원대 확인 필요',
[('08:00','부산 출발'),('12:00','단양/제천 도착·점심'),('13:30','패러글라이딩/카트 2~3시간'),('17:00','숙소 체크인'),('19:00','바비큐/저녁'),('2일차','카페산·도담삼봉'),('12:30','점심 후 부산 복귀')],
['액티비티 임팩트 최고','사진/영상 남기기 좋음','평소와 다른 여행 느낌'],['이동시간 길어 피로도 큼','패러글라이딩 포함 시 예산 초과 가능'],'재미는 강하지만 현실성은 낮음',COL['purple']),10,'danyang_jecheon'))
paths.append(save(candidate_slide(11,'강릉·양양','서핑 특별픽 / 참고 후보','부산 약 348~395km / 체감 6시간 전후','서핑·동해·카페/펍','서핑 5만~8만원대 확인 필요',
[('07:00','부산 출발'),('13:00','강릉/양양 도착·점심'),('14:30','서핑 강습 2~3시간'),('18:00','숙소 체크인'),('19:30','바닷가 회식/펍'),('2일차','카페·해장'),('12:00','부산 복귀 시작')],
['특별함과 여행 분위기 최고','동해 감성·서핑 경험 가능','사진 남기기 좋음'],['왕복 이동시간이 너무 김','1박2일 효율 낮고 예산 초과 가능'],'투표 후보보다는 참고 후보',COL['red']),11,'gangneung_yangyang'))
# 12 schedule compare
im=bg_for(12); d=ImageDraw.Draw(im); title(d,12,'후보별 일정표 비교','소요시간과 일정 난이도를 한눈에 비교')
rows=[('경주','10:00 출발','루지/카트 1.5~2h','저녁 회식 여유','낮음'),('거제·통영','10:00 출발','카트/루지 1.5~2h','바비큐/해산물','낮음'),('여수','09:00 출발','케이블카/유월드 1.5~3h','낭만포차','중간'),('단양·제천','08:00 출발','패러글라이딩 2~3h','바비큐','높음'),('강릉·양양','07:00 출발','서핑 2~3h','바닷가 회식','매우 높음')]
table(d,80,250,1880,100,['후보','출발','주요 액티비티','저녁','피로도'],rows,[280,260,520,420,260])
d.rounded_rectangle((120,875,1880,955),radius=24,fill='#E8F1FF',outline='#BBD2FF')
d.text((155,899),'보고 포인트: 1박2일은 이동보다 노는 시간이 중요하므로, 출발 시간이 늦어도 가능한 경주·거제/통영이 유리합니다.',font=F['small'],fill=COL['navy'])
paths.append(save(im,12,'schedule_compare'))
# 13 ranking
im=bg_for(13); d=ImageDraw.Draw(im); title(d,13,'종합 추천 순위','15만원·부산 출발·활동성 기준 결론')
ranks=[('1위','경주','가장 안정적','예산·이동·대체일정 모두 우수',COL['mint']),('2위','거제·통영','가장 재밌는 현실픽','카트/루지+바다+단체숙소',COL['blue']),('3위','여수','분위기 좋은 여행픽','야경·맛집 좋지만 예산 조절',COL['orange']),('4위','단양·제천','액티비티 도전픽','재미 강하지만 이동/비용 부담',COL['purple']),('참고','강릉·양양','장거리 특별픽','특별하지만 1박2일 비효율',COL['red'])]
for i,(r,n,tag,desc,c) in enumerate(ranks):
    y=220+i*158
    shadow_card(im,(130,y,1900,y+118),24,(255,255,255,240)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((165,y+24,285,y+92),radius=20,fill=c)
    d.text((190 if r!='참고' else 181,y+42),r,font=F['small'],fill='white')
    d.text((330,y+27),n,font=F['h2'],fill=COL['dark'])
    d.text((625,y+30),tag,font=F['h3'],fill=c)
    d.text((1020,y+36),desc,font=F['small'],fill=COL['gray'])
paths.append(save(im,13,'ranking'))
# 14 vote
im=bg_for(14); d=ImageDraw.Draw(im); title(d,14,'최종 투표 방식','오늘은 여행지 후보만 먼저 결정')
shadow_card(im,(90,230,980,940),32,(255,255,255,242)); d=ImageDraw.Draw(im)
d.text((140,285),'1차 투표',font=F['h2'],fill=COL['navy'])
bullets(d,150,360,['가고 싶은 여행지 1순위 / 2순위 선택','1순위 2점, 2순위 1점으로 합산','상위 2개 후보만 남기기','동점이면 이동시간 짧은 후보 우선'],size='h3',gap=72,chars=26)
shadow_card(im,(1060,230,1960,940),32,(255,255,255,242)); d=ImageDraw.Draw(im)
d.text((1110,285),'2차 투표',font=F['h2'],fill=COL['navy'])
bullets(d,1120,360,['날짜 후보 확정','숙소 스타일 선택: 펜션/풀빌라/호텔','액티비티 횟수와 예산 확정','예약 전 최종 가격 재확인'],size='h3',gap=72,chars=26,bullet=COL['orange'])
d.rounded_rectangle((290,990,1760,1060),radius=26,fill=COL['navy'])
d.text((390,1009),'추천: 경주 vs 거제·통영을 최종 후보로 두고 투표하면 결정이 빠릅니다.',font=F['h3'],fill='white')
paths.append(save(im,14,'final_vote'))
# contact sheet and pdf
thumbs=[Image.open(p).convert('RGB').resize((512,288)) for p in paths]
cs=Image.new('RGB',(1120,2550),'#F3F6FA'); cd=ImageDraw.Draw(cs)
cd.text((48,34),'V3 보고형 여행 투표 슬라이드 최종 미리보기',font=font(36),fill=COL['navy'])
for i,im2 in enumerate(thumbs):
    x=48+(i%2)*535; y=110+(i//2)*340
    cs.paste(im2,(x,y)); cd.rectangle((x,y,x+512,y+288),outline='#CBD5E1',width=2)
    cd.text((x+6,y+298),paths[i].stem,font=font(20),fill=COL['gray'])
cs.save(BASE/'00_v3_final_contact_sheet.png',quality=95)
imgs=[Image.open(p).convert('RGB') for p in paths]
imgs[0].save(BASE/'1990_class_trip_vote_slides_v3_report.pdf',save_all=True,append_images=imgs[1:])
print(BASE/'00_v3_final_contact_sheet.png')
print(BASE/'1990_class_trip_vote_slides_v3_report.pdf')
for p in paths: print(p)
