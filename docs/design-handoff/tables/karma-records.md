# Real karma records

The two souls behind `27-soul-detail-full-history.png` and
`28-soul-detail-awaiting-judgment.png`, straight from
`GET /souls/{id}/karma/`.

Every record carries a written description, a category, an event date and a
decay factor computed from that date. None of it reaches the screen today —
the detail page renders totals and a sparkline, never an individual record —
which is why the Stage 3 spine had to invent labels. These are the real ones.


## 崔明远 → 沈砚秋 — complete cycle

`4a4e298f-8928-48b9-8094-105f85945894`

merit **38** · demerit **11** · nominal balance **27** · 7 records

decayed balance **+26.3**


| date | type | category | weight | decay | effective | description |
|---|---|---|---|---|---|---|
| 1969-11-08 | 罪业 | 怯懦 `COWARDICE` | 14 | ×0.567 (56.7y) | 7.94 | 同窗遭构陷时缄默不言，事后三十年未曾辩白。 |
| 1984-09-01 | 功德 | 智慧 `WISDOM` | 18 | ×0.658 (41.9y) | 11.84 | 于乡间创办免费蒙学，四十一年间授业逾八百人。 |
| 1988-06-30 | 罪业 | 贪婪 `GREED` | 5 | ×0.683 (38.1y) | 3.42 | 受乡绅馈赠田契一纸，未即退还，逾年方归。 |
| 1991-07-22 | 功德 | 布施 `CHARITY` | 12 | ×0.705 (35.0y) | 8.45 | 水患之年变卖祖宅田产，尽数捐予邻里购粮。 |
| 1996-04-03 | 功德 | 诚信 `HONESTY` | 9 | ×0.738 (30.3y) | 6.65 | 县志修撰中拒改先人劣迹，坚持据实录入。 |
| 2003-02-17 | 功德 | 慈悲 `COMPASSION` | 7 | ×0.791 (23.5y) | 5.54 | 收养亡故学生之遗孤二人，抚养至成年。 |
| 2011-10-09 | 功德 | 虔敬 `PIETY` | 6 | ×0.862 (14.8y) | 5.17 | 每岁清明独往祭扫无主之坟，历二十载不辍。 |

## 白鹤龄 — awaiting judgment

`707d3e09-ab60-451d-b93f-3d3661db175b`

merit **30** · demerit **17** · nominal balance **13** · 6 records

decayed balance **+13.0**


| date | type | category | weight | decay | effective | description |
|---|---|---|---|---|---|---|
| 1975-08-11 | 功德 | 勇毅 `COURAGE` | 22 | ×0.601 (51.0y) | 13.21 | 钱塘江决口之夜率丁夫二百堵口，浸水中立十九时辰。 |
| 1982-05-04 | 功德 | 智慧 `WISDOM` | 11 | ×0.642 (44.2y) | 7.07 | 改绘塘堰图式，后为四县所沿用。 |
| 1990-03-19 | 罪业 | 欺诈 `DECEPTION` | 16 | ×0.695 (36.4y) | 11.12 | 工料账目虚报石方，事发后归还，然案卷未销。 |
| 1991-06-15 | 罪业 | 贪婪 `GREED` | 9 | ×0.704 (35.1y) | 6.33 | 受营造商程仪银二十两。 |
| 1997-12-01 | 功德 | 布施 `CHARITY` | 8 | ×0.751 (28.7y) | 6.01 | 以私财补发欠饷，惠及丁夫四十七人。 |
| 2008-04-22 | 功德 | 慈悲 `COMPASSION` | 5 | ×0.833 (18.3y) | 4.16 | 岁末代付同乡丧葬之费。 |


## Notes

- `category` is one of thirteen values on the model — six merit (CHARITY, COMPASSION, HONESTY, COURAGE, WISDOM, PIETY), six demerit (CRUELTY, DECEPTION, COWARDICE, GREED, BLASPHEMY, MURDER), plus OTHER. There is no Chinese translation for them in the bundles yet; the column above is a suggestion, not shipped copy.
- `is_milestone` is also stored per record and is true for the deed that defines the life. Neither soul's milestones are surfaced anywhere today.
- `decay_factor` and `years_elapsed` are computed by the backend from `event_date`. They only became real in ace2625.
