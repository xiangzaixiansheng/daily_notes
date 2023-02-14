## group by的一些优化方案

从哪些方向去优化呢？

- 方向1： 既然它默认会排序，我们不给它排是不是就行啦。
- 方向2：既然临时表是影响group by性能的X因素，我们是不是可以不用临时表？

我们一起来想下，执行group by语句为什么需要临时表呢？group by的语义逻辑，就是统计不同的值出现的个数。如果这个**这些值一开始就是有序的**，我们是不是直接往下扫描统计就好了，就不用**临时表来记录并统计结果**啦?

- group by 后面的字段加索引
- order by null 不用排序
- 尽量只使用内存临时表
- 使用SQL_BIG_RESULT

**5.1 group by 后面的字段加索引**

如何保证group by后面的字段数值一开始就是有序的呢？当然就是**加索引**啦。

我们回到一下这个SQL

select city ,count(*) as num from staff where age= 19 group by city

它的执行计划

如果我们给它加个联合索引idx_age_city（age,city）

alter table staff add index idx_age_city(age,city);

再去看执行计划，发现既不用排序，也不需要临时表啦。

**加合适的索引**是优化group by最简单有效的优化方式。



**5.2 order by null 不用排序**

并不是所有场景都适合加索引的，如果碰上不适合创建索引的场景，我们如何优化呢？

如果你的需求并不需要对结果集进行排序，可以使用order by null。

select city ,count(*) as num from staff group by city order by null

执行计划如下，已经没有filesort啦



**5.3 尽量只使用内存临时表**

如果group by需要统计的数据不多，我们可以尽量只使用**内存临时表**；因为如果group by 的过程因为数据放不下，导致用到磁盘临时表的话，是比较耗时的。因此可以适当调大tmp_table_size参数，来避免用到**磁盘临时表**。

**5.4 使用SQL_BIG_RESULT优化**

如果数据量实在太大怎么办呢？总不能无限调大tmp_table_size吧？但也不能眼睁睁看着数据先放到内存临时表，**随着数据插入**发现到达上限，再转成磁盘临时表吧？这样就有点不智能啦。

因此，如果预估数据量比较大，我们使用SQL_BIG_RESULT 这个提示直接用磁盘临时表。MySQl优化器发现，磁盘临时表是B+树存储，存储效率不如数组来得高。因此会直接用数组来存

示例SQl如下：

select SQL_BIG_RESULT city ,count(*) as num from staff group by city;

执行计划的Extra字段可以看到，执行没有再使用临时表，而是只有排序

执行流程如下：

1. 初始化 sort_buffer，放入city字段；
2. 扫描表staff，依次取出city的值,存入 sort_buffer 中；
3. 扫描完成后，对 sort_buffer的city字段做排序
4. 排序完成后，就得到了一个有序数组。
5. 根据有序数组，统计每个值出现的次数。



##  **group by 的简单执行流程**

explain select city ,count(*) as num from staff group by city;

我们一起来看下这个SQL的执行流程哈

1. 创建内存临时表，表里有两个字段city和num；
2. 全表扫描staff的记录，依次取出city = 'X'的记录。

- 判断**临时表**中是否有为 city='X'的行，没有就插入一个记录 (X,1);
- 如果临时表中有city='X'的行的行，就将x 这一行的num值加 1；

1. 遍历完成后，再根据字段city做**排序**，得到结果集返回给客户端。

备注：EXPLAIN 这个sql可能会看见

- Extra 这个字段的Using temporary表示在执行分组的时候使用了**临时表**
- Extra 这个字段的Using filesort表示使用了**排序**

临时表的排序是怎样的呢？

就是把需要排序的字段，放到sort buffer，排完就返回。在这里注意一点哈，排序分**全字段排序**和**rowid排序**

- 如果是全字段排序，需要查询返回的字段，都放入sort buffer，根据**排序字段**排完，直接返回
- 如果是rowid排序，只是需要排序的字段放入sort buffer，然后多一次**回表**操作，再返回。
- 怎么确定走的是全字段排序还是rowid 排序排序呢？由一个数据库参数控制的，max_length_for_sort_data



