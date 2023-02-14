

## 一、优化方向：

1）redis的大key(需要优化改进的keys、可以删除的key)

2）开启redis的自动内存碎片回收



## 二、优化

### 2.1问题：

大key会带来的问题如下：

1）集群模式在slot分片均匀情况下，会出现数据和查询倾斜情况，部分有大key的Redis节点占用内存多，QPS高。

2）大key相关的删除或者自动过期时，会出现qps突降或者突升的情况，极端情况下，会造成主从复制异常，Redis服务阻塞无法响应请求。

基于以上原因，需要对项目的缓存进行优化。

ps：大key

  谈到缩容，最直接的方法肯定是分析出占用内存最大的key，对其进行优化。从此处开始，文章中提到的大key不单指单个大key，类似几百万数据的hash集合；也包含了一类key的占用了较大的空间，例如实例存在1000万个 **user:info:{userid}** 的string类型的key，我们也将它称为大key。

### 2.2 分析大key

| 方案                                                         | 优缺点                                                       | 是否选用 |
| ------------------------------------------------------------ | ------------------------------------------------------------ | -------- |
| bigkeys命令                                                  | 优点：使用简单 缺点：耗时较长，只能统计五种基础数据，无法对一类key名称进行匹配，只能找出单个大key | 否       |
| 在单台实例执行bgSave，dump下来对应的RDB文件，使用对应的分析工具进行分析。我们使用的是rdb_bigkeys | 优点：对业务不造成影响，本地数据，随时可以进行分析 缺点：时效性较弱 | 是       |
| 扫描脚本，使用scan命令配合扫描整台实例的keys                 | 优点：支持任意数据类型，时效性高 缺点：虽然scan命令不阻塞主线程，但是大范围扫描keys还是会加重实例的IO，可以闲时再执行。 | 否       |

推荐使用方案二；

对于不合理的keys，我们分为两类：

- 需要优化改进的keys
- 可以直接删除的keys



### **2.3、需要优化改进的keys**

这就需要针对业务场景做针对性处理了，只能给出一些典型例子的建议：

- 选择合理的过期时间，结合业务能短尽量短。
- 选择合适的数据结构：例如我们现在设计一个key用于存储一些信息。假定key和value的大小用了16个字节，但是由于RedisObject32b(元数据 8b+SDS指针8b+16b key value数据)、dictEntry 32b(三个指针24b，jellmoc分配出32b)。导致一个string的key需要存64b，冗余了很多数据。

**优化方式**：将每个Key取hash code，然后按照业务对指定的业务分成n片，用hash code对n取模。此时我们使用hset info:{hash code%n} {key} {value}存储，通过修改hash-max-ziplist-entries(用压缩列表保存时哈希集合中的最大元素个数)和hash-max-ziplist-value(用压缩列表保存时哈希集合中单个元素的最大长度)来控制hash使用ziplist存储，节省空间。 这样可以节省dictEntry开销，剩下32b的空间。

具体详情可以阅读 [Redis核心技术实战](https://link.juejin.cn?target=https%3A%2F%2Ftime.geekbang.org%2Fcolumn%2Fintro%2F100056701) 的第11章，讲得非常清晰。

- 使用一定的序列化方式压缩存储空间，例如protobuf。



### **2.4可以直接删除的keys**

对于可以直接删除的keys，**建议使用scan命令+unlink命令删除**，避免主线程阻塞。我们采用的删除方式是：scan轮流扫描各个实例，匹配需要删除的Keys。

**风险点：**

大家都知道对于客户端命令的执行，Redis是单线程处理的，所以存在一些阻塞主线程的操作风险：

- **对于一个占用内存非常大的key，不可直接使用del命令**。
- Redis具有定时清理过期keys的策略，若有大批key在同一时间过期，会导致每次采样过期的keys都超过采样数量的25%，循环进行删除操作，影响主线程性能。可参考：[定期删除策略](https://link.juejin.cn?target=https%3A%2F%2Fwww.cnblogs.com%2Fzjoch%2Fp%2F11149278.html)

**解决方案**：避免对大量key使用expiret加指定过期时间，需要将过期时间+随机数打散过期时机；由于我们的集群使用5.0版本，定位到定时清除过期Keys的代码**serverCron()->databasesCron()->activeExprireCycle()→dbSyncDelete()** ，内部删除方式采用unlink异步删除，不影响主线程。

- 评估删除了keys对业务的影响

  **解决方案**：需要结合业务进行风险点评估；做好数据监控，例如异常告警、MySQL的QPS等。

### **2.5、优化了许多keys，内存占用还是很高，怎么回事？**

Redis日常的使用是会存在内存碎片的，可在redis客户端执行info memory命令。如果**mem_fragmentation_ratio**值大于1.5，那么说明内存碎片超过50%，需要进行碎片整理了

**解决方案**：

- 重启Redis实例，暴力解决，不推荐
- 使用 **config set activedefrag yes** 命令，调整以下参数进行自动清理

以上命令启动自动清理，但是具体什么时候清理，还要受以下两个参数的影响：

1. `active-defrag-ignore-bytes 400mb`：如果内存碎片达到了`400mb`，开始清理（自定义）
2. `active-defrag-threshold-lower 20`：内存碎片空间占操作系统分配给 Redis 的总空间比例达到`20%`时，开始清理（自定义）

以上两个参数只有全部满足才会开始清理

除了以上触发清理内存碎片的参数，Redis还提供了两个参数来保证在清理过程中不影响处理正常的请求，如下：

1. `active-defrag-cycle-min 25`：表示自动清理过程所用 `CPU` 时间的比例不低于`25%`，保证清理能正常开展
2. `active-defrag-cycle-max 75`：表示自动清理过程所用 `CPU` 时间的比例不高于`75%`，一旦超过，就停止清理，从而避免在清理时，大量的内存拷贝阻塞 Redis，导致响应延迟升高。

### 2.6、 可以设置redis的最大占用内存

**1、通过配置文件配置**

通过在Redis安装目录下面的redis.conf配置文件中添加以下配置设置内存大小

```
//设置Redis最大占用内存大小为100M
maxmemory 100mb
复制代码
```

redis的配置文件不一定使用的是安装目录下面的redis.conf文件，启动redis服务的时候是可以传一个参数指定redis的配置文件的

**2、通过命令修改**

Redis支持运行时通过命令动态修改内存大小

```
//设置Redis最大占用内存大小为100M
127.0.0.1:6379> config set maxmemory 100mb
//获取设置的Redis能使用的最大内存大小
127.0.0.1:6379> config get maxmemory
复制代码
```

如果不设置最大内存大小或者设置最大内存大小为0，在64位操作系统下不限制内存大小，在32位操作系统下最多使用3GB内存

### 2.7、可以设置redis的内存淘汰机制

实际上Redis定义了几种策略用来处理这种情况：

- noeviction(默认策略)：对于写请求不再提供服务，直接返回错误（DEL请求和部分特殊请求除外）
- allkeys-lru：从所有key中使用LRU算法进行淘汰
- volatile-lru：从设置了过期时间的key中使用LRU算法进行淘汰
- allkeys-random：从所有key中随机淘汰数据
- volatile-random：从设置了过期时间的key中随机淘汰
- volatile-ttl：在设置了过期时间的key中，根据key的过期时间进行淘汰，越早过期的越优先被淘汰

当使用volatile-lru、volatile-random、volatile-ttl这三种策略时，如果没有key可以被淘汰，则和noeviction一样返回错误

**如何获取及设置内存淘汰策略**

获取当前内存淘汰策略：

```
127.0.0.1:6379> config get maxmemory-policy
复制代码
```

通过配置文件设置淘汰策略（修改redis.conf文件）：
 `maxmemory-policy allkeys-lru`

通过命令修改淘汰策略：

```
127.0.0.1:6379> config set maxmemory-policy allkeys-lru
```

