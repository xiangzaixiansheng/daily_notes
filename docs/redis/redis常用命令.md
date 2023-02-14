## 1、redis批量删除

```
redis-cli --scan --pattern "hanxiang*" | xargs -L 2000 redis-cli unlink 
```

其中xargs -L指令表示xargs一次读取的行数，也就是每次删除的key数量，一次读取太多xargs会报错

类似的SCAN命令，对于Redis不同的数据类型还有另外几个SSCAN、HSCAN和ZSCAN，使用方法类似：

对于一个大的set key，借助sscan使用下边的代码可以实现优雅的批量删除：

```
import redis
 
def del_big_set_key(key_name):
 r = redis.StrictRedis(host='localhost', port=6379)
 
 # count表示每次删除的元素数量，这里每次删除300元素
 for key in r.sscan_iter(name=key_name, count=300):
 r.srem(key_name, key)
 
del_big_set_key('ops-coffee')
```

对于一个大的hash key，则可借助hscan使用下边的代码实现优雅的删除：

```
import redis
 
def del_big_hash_key(key_name):
 r = redis.StrictRedis(host='localhost', port=6379)
 
 # hscan_iter获取出来的结果是个元祖，下边hdel删除用key[0]取到key
 for key in r.hscan_iter(name=key_name, count=300):
 r.hdel(key_name, key[0])
 
del_big_hash_key('ops-coffee')
```

对于大的有序集合的删除就比较简单了，直接根据zremrangebyrank排行范围删除

```
import redis
 
def del_big_sort_key(key_name):
 r = redis.StrictRedis(host='localhost', port=6379)
 
 while r.zcard(key_name) > 0:
 # 判断集合中是否有元素，如有有则删除排行0-99的元素
 r.zremrangebyrank(key_name, 0, 99)
 
del_big_sort_key('ops-coffee')
```

## 2、redis 登录命令

```
redis-cli -h localhost -p 33169
```

