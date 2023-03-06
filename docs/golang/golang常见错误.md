

## 1.  JSON 四状态问题

在Go中通过标准库解析JSON时，我们经常要对单个字段区分四个状态，分别是:

- 存在且 非0 值
- 存在为 0 值
- 存在为 null
- 缺失 四个状态中，null 和 缺失一般可以视为同一个状态，但是0值缺失值由于类型安全的语言特性使得不得不填充0值。这对于一些默认状态为0值的服务来说可能造成判断失效。举个栗子，在Go中一般定义一个字段为int， 当进行一个http body 解析后，如果原始json中不存在 该字段，该字段也会被解析成 0 值。但是由于传统习惯以code=0 作为成功的响应，所以很容易造成对错误的误判导致出现bug. 一个较为通常的做法是，将 字段定义为*int 类型，这样在字段值不存在时将会被填充为 nil，区分了0值与缺失状态。

## 2. JSON String Number 问题

在JavaScript中，Number类型的最大值是 2 的 53 次方，超过这个数字会造成精度丢失，一般的做法是转为String。这时只需要将 字段对应的tag标记为支持从String转换为int64.示例如下:

```go
type Foo struct {
	A int64 `json:"a,string"`
}

func main(){
	rawString := `{"a": "1"}`
	var foo Foo
	if err := json.Unmarshal([]byte(rawString), &foo); err != nil {
		panic(err)
	}
	fmt.Printf("int: %+v\n", foo)
}
```

## 3. JSON int类型 断言问题

如果你得到了这样一个JSON: `{"foo": 1}` 但是你不想写个Struct来专门解析，你想用转成 `map[string]interface{}`, 然后将foo的值断言为 int值，这时候容易错的是，`json.Unmarshal` 库会将number 值默认转为的是  `float64` 类型, 从而造成断言失败。

## 4. map 扩缩容问题

我们知道map初始化时可以通过make函数来预先开辟内存空间，并在map中新增key时会进行自动的扩容.但是，截止目前为止(go 1.16)，go map 中开辟的bucket占用的空间不会自动缩容，也不会被GC，这甚至可能引起OOM。 详细可以参考 [#20135](https://link.juejin.cn?target=https%3A%2F%2Fgithub.com%2Fgolang%2Fgo%2Fissues%2F20135) 。以下这段代码将打印各个阶段占用的内存:

```go
func main() {
	v := struct{}{}
	a := make(map[int]struct{})
	for i := 0; i < 100000; i++ {
		a[i] = v
	}
	runtime.GC()
	printMemStats("After Map Add 1000000")
	for i := 0; i < 100000-1; i++ {
		delete(a, i)
	}
	runtime.GC()
	printMemStats("After Map Delete 99999")
	for i := 0; i < 100000-1; i++ {
		a[i] = v
	}
	runtime.GC()
	printMemStats("After Map Add 99999 again")
	fmt.Printf("%d\n", len(a))
	a = nil
	runtime.GC()
	printMemStats("After Map Set nil")
}

func printMemStats(mag string) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	fmt.Printf("%v：memory = %vKB, GC Times = %v\n", mag, m.Alloc/1024, m.NumGC)
}
复制代码
After Map Add 1000000：memory = 1625KB, GC Times = 1
After Map Delete 99999：memory = 1628KB, GC Times = 2
After Map Add 99999 again：memory = 1628KB, GC Times = 3
100000
After Map Set nil：memory = 117KB, GC Times = 4
复制代码
```

可以看到的是，删除并且GC后内存依然占用很高。这种情况在一些生命周期很长的Map使用过程中应该特别注意。对此，官方的推荐是，new一个新的。

## 5. nil 和 interface nil 空值判断问题

定义某个类型的空值的变量，将这个变量赋值给一个interface，你会神奇的发现: 空值判断失效了！这个问题出自: [golang-nuts](https://link.juejin.cn?target=https%3A%2F%2Fgroups.google.com%2Fg%2Fgolang-nuts%2Fc%2FwnH302gBa4I%2Fdiscussion)

```go
type someType struct{ f1 string }

func main() {
	var v *someType
	var v2 interface{}
	v2 = v
	fmt.Printf("v2 == nil: %t\n", v2 == nil)
	fmt.Printf("v2 reflected val is nil: %t\n", reflect.ValueOf( v2 ).IsNil() )
}
复制代码
```

对这个问题的解释是interface类型的实现是type和value，v2 == nil 判断的是 v2是否为空值，而这里interface并不是空值，而是该interface hold 了一个类型为 *someType 的 nil值，所以造成了判断失效。所以对interface的判断要特别注意，也要注意尽量不要将某类型的nil值传入一个interface中。

## 6.  默认时区问题

如果 一个 字符串中没有时区信息，默认转为UTC时区,  而time.Now 默认为 当前系统时区。如果你期望的是当前时区， 可能造成时间错误。

```css
func main(){
	format := "2006-01-02 15:04"
	t, _ := time.Parse(format, "2021-05-10 14:00")
	fmt.Println(t)
	fmt.Println("现在是: ", time.Now())
}
复制代码
```

输出结果:

```bash
2021-05-10 14:00:00 +0000 UTC
现在是:  2021-05-10 14:41:01.241168 +0800 CST m=+0.000088626

```

应该：

```
//标准格式转为time
func TimeByFormat(format string, timeFormat string) (time.Time, error) {
	loc, _ := time.LoadLocation("Local") //获取当地时区
	return time.ParseInLocation(timeFormat, format, loc)
}
```



可以看到的是，指定的没有时区的字符串被解析成了 UTC时区，但是 now 生成的时间是 系统时区。需要注意对没有时区的字符串时间提高警惕。